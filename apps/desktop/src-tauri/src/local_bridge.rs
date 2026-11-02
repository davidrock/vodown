//! Per-user Unix transport for the Native Messaging host. No captures or tokens
//! are accepted until pairing is implemented.
#[cfg(unix)]
mod unix {
    use std::{io, os::unix::{fs::{DirBuilderExt, MetadataExt}, net::{UnixListener, UnixStream}}, path::{Path, PathBuf}, time::Duration};
    use crate::native_protocol;
    pub fn start(directory:&Path)->io::Result<()> {
        let private=directory.join("ipc");
        match std::fs::DirBuilder::new().mode(0o700).create(&private) {
            Ok(())=>(), Err(e) if e.kind()==io::ErrorKind::AlreadyExists=>(), Err(e)=>return Err(e)
        }
        let metadata=std::fs::symlink_metadata(&private)?;
        let parent=std::fs::metadata(directory)?;
        if !metadata.is_dir() || metadata.mode() & 0o077 != 0 || metadata.uid()!=parent.uid() {
            return Err(io::Error::new(io::ErrorKind::PermissionDenied,"Diretório IPC inseguro"));
        }
        let path=private.join("desktop.sock");
        if path.exists() {
            if UnixStream::connect(&path).is_ok() { return Err(io::Error::new(io::ErrorKind::AddrInUse,"Desktop já conectado")); }
            let info=std::fs::symlink_metadata(&path)?;
            use std::os::unix::fs::FileTypeExt;
            if !info.file_type().is_socket() || info.uid()!=parent.uid() {return Err(io::Error::new(io::ErrorKind::PermissionDenied,"Socket IPC inválido"));}
            std::fs::remove_file(&path)?;
        }
        let listener=UnixListener::bind(path)?;
        std::thread::spawn(move || {
            for stream in listener.incoming() {
                let Ok(mut stream)=stream else {continue};
                let _=stream.set_read_timeout(Some(Duration::from_secs(2)));
                let _=stream.set_write_timeout(Some(Duration::from_secs(2)));
                if let Ok(Some(frame))=native_protocol::read_frame(&mut stream) {
                    if let Some(reply)=crate::pairing::handle(&frame) {
                        use std::io::Write;
                        let _=stream.write_all(&(reply.len() as u32).to_ne_bytes()).and_then(|_|stream.write_all(&reply));
                        continue;
                    }
                    let mut response=native_protocol::handle(&frame);
                    if response.code=="desktop_not_connected" {
                        response.code="desktop_connected";
                        let (pending,paired)=crate::pairing::connection_state();
                        if let Ok(mut value)=serde_json::to_value(&response) {
                            value["pairPending"]=pending.into();value["paired"]=paired.into();
                            value["readingDiagnostic"]=crate::pairing::reading_diagnostic().into();
                            if let Ok(reply)=serde_json::to_vec(&value) {
                                use std::io::Write;
                                let _=stream.write_all(&(reply.len() as u32).to_ne_bytes()).and_then(|_|stream.write_all(&reply));
                                continue;
                            }
                        }
                    }
                    let _=native_protocol::write_frame(&mut stream,&response);
                }
            }
        });
        Ok(())
    }
    pub fn path()->Option<PathBuf> {
        #[cfg(target_os="macos")]
        return Some(PathBuf::from(std::env::var_os("HOME")?).join("Library/Application Support/com.vodown.desktop/ipc/desktop.sock"));
        #[cfg(not(target_os="macos"))]
        None
    }
    pub fn forward(frame:&[u8])->io::Result<Vec<u8>> {
        use std::io::Write;
        let path=path().ok_or_else(||io::Error::new(io::ErrorKind::Unsupported,"Sistema não suportado"))?;
        let mut stream=UnixStream::connect(path)?;
        stream.set_read_timeout(Some(Duration::from_secs(3)))?;
        stream.set_write_timeout(Some(Duration::from_secs(3)))?;
        stream.write_all(&(frame.len() as u32).to_ne_bytes())?;
        stream.write_all(frame)?;
        native_protocol::read_frame(&mut stream)?.ok_or_else(||io::Error::new(io::ErrorKind::UnexpectedEof,"Desktop desconectado"))
    }
}
#[cfg(unix)] pub use unix::*;

#[cfg(all(test,unix))]
mod tests {
    use super::*;
    use std::{io::Write,os::unix::{fs::PermissionsExt,net::UnixStream}};
    #[test]
    fn connects_to_desktop_and_rejects_insecure_directory() {
        let root=std::env::temp_dir().join(format!("vodown-ipc-{}-{}",std::process::id(),std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap().as_nanos()));
        std::fs::create_dir(&root).unwrap();
        start(&root).unwrap();
        let mut stream=UnixStream::connect(root.join("ipc/desktop.sock")).unwrap();
        let frame=br#"{"version":1,"requestId":"probe","type":"hello"}"#;
        stream.write_all(&(frame.len() as u32).to_ne_bytes()).unwrap();
        stream.write_all(frame).unwrap();
        let reply=crate::native_protocol::read_frame(&mut stream).unwrap().unwrap();
        let json:serde_json::Value=serde_json::from_slice(&reply).unwrap();
        assert_eq!(json["code"],"desktop_connected");
        assert!(json["capabilities"].as_array().unwrap().iter().all(|c|c=="handshake"));
        let _guard=crate::pairing::TEST_LOCK.lock().unwrap();
        crate::pairing::bridge_reset();
        let exchange=|request:serde_json::Value| {
            let mut socket=UnixStream::connect(root.join("ipc/desktop.sock")).unwrap();
            let bytes=serde_json::to_vec(&request).unwrap();
            socket.write_all(&(bytes.len() as u32).to_ne_bytes()).unwrap();
            socket.write_all(&bytes).unwrap();
            serde_json::from_slice::<serde_json::Value>(&crate::native_protocol::read_frame(&mut socket).unwrap().unwrap()).unwrap()
        };
        assert_eq!(exchange(serde_json::json!({"version":1,"requestId":"pair-1","type":"pair","nonce":"socket-nonce","accessToken":"fixture-only"}))["code"],"pair_pending");
        crate::pairing::bridge_accept("socket-nonce".into()).unwrap();
        let paired=exchange(serde_json::json!({"version":1,"requestId":"status-1","type":"pair_status","nonce":"socket-nonce"}));
        assert_eq!(paired["code"],"paired");
        let result=exchange(serde_json::json!({"version":1,"requestId":"inventory-1","type":"inventory","pairToken":paired["pairToken"],"inventory":{"title":"Curso de teste","platform":"whop","lessons":[{"id":"one","title":"Primeira aula"}]}}));
        assert_eq!(result["code"],"inventory_received");
        assert_eq!(crate::pairing::bridge_inventory().unwrap().lessons[0].title,"Primeira aula");
        crate::pairing::bridge_reset();
        std::fs::set_permissions(root.join("ipc"),std::fs::Permissions::from_mode(0o755)).unwrap();
        assert_eq!(start(&root).unwrap_err().kind(),std::io::ErrorKind::PermissionDenied);
        let _=std::fs::remove_dir_all(root);
    }
}
