use std::{fs::{File,OpenOptions},io::Write,path::{Path,PathBuf},sync::Mutex};
struct Transfer {job:String,file:Option<File>,partial:PathBuf,target:PathBuf,offset:u64}
impl Drop for Transfer {fn drop(&mut self){drop(self.file.take());let _=std::fs::remove_file(&self.partial);}}
#[cfg(test)]
pub static TEST_LOCK:Mutex<()>=Mutex::new(());
static TRANSFER:Mutex<Option<Transfer>>=Mutex::new(None);
pub fn cancel(){if let Ok(mut transfer)=TRANSFER.lock(){*transfer=None;}}
pub fn begin(root:&Path,directory:&Path,name:&str,job:&str)->Result<&'static str,()> {
    cancel();std::fs::create_dir_all(directory).map_err(|_|())?;
    if !directory.canonicalize().map_err(|_|())?.starts_with(root.canonicalize().map_err(|_|())?){return Err(());}
    let target=directory.join(crate::path_parts::safe_name(name));
    if target.is_file(){return Ok("material_skipped");}
    let partial=directory.join(format!(".{}.material-part",crate::path_parts::safe_name(job)));
    let file=OpenOptions::new().create_new(true).write(true).open(&partial).map_err(|_|())?;
    *TRANSFER.lock().map_err(|_|())?=Some(Transfer{job:job.into(),file:Some(file),partial,target,offset:0});Ok("material_ready")
}
pub fn chunk(job:&str,offset:u64,bytes:&[u8])->Result<(),()> {
    if bytes.len()>32768{return Err(());}
    let mut state=TRANSFER.lock().map_err(|_|())?;let transfer=state.as_mut().ok_or(())?;
    if transfer.job!=job || transfer.offset!=offset || offset+bytes.len() as u64>536870912{return Err(());}
    transfer.file.as_mut().ok_or(())?.write_all(bytes).map_err(|_|())?;transfer.offset+=bytes.len() as u64;Ok(())
}
pub fn finish(job:&str,size:u64)->Result<(),()> {
    let mut state=TRANSFER.lock().map_err(|_|())?;
    let transfer=state.as_mut().ok_or(())?;
    if transfer.job!=job || transfer.offset!=size{return Err(());}
    transfer.file.as_ref().ok_or(())?.sync_all().map_err(|_|())?;
    std::fs::hard_link(&transfer.partial,&transfer.target).map_err(|_|())?;
    *state=None;Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn streams_atomically_skips_existing_and_cleans_cancelled_files() {
        let _guard=TEST_LOCK.lock().unwrap();
        let root=std::env::temp_dir().join(format!("vodown-material-writer-{}",std::process::id()));
        let directory=root.join("Curso").join("Modulo").join("Materiais");
        let _=std::fs::remove_dir_all(&root);
        assert_eq!(begin(&root,&directory,"Exercício.pdf","job").unwrap(),"material_ready");
        assert!(!directory.join("Exercício.pdf").exists());
        assert!(chunk("other",0,b"bad").is_err());
        chunk("job",0,b"%PDF-").unwrap();
        assert!(chunk("job",0,b"duplicate").is_err());
        assert!(finish("job",99).is_err());
        chunk("job",5,b"test").unwrap();finish("job",9).unwrap();
        assert_eq!(std::fs::read(directory.join("Exercício.pdf")).unwrap(),b"%PDF-test");
        assert_eq!(begin(&root,&directory,"Exercício.pdf","job").unwrap(),"material_skipped");
        begin(&root,&directory,"Outro.pdf","job").unwrap();chunk("job",0,b"partial").unwrap();cancel();
        assert!(!directory.join("Outro.pdf").exists());
        assert_eq!(std::fs::read_dir(&directory).unwrap().count(),1);
        assert!(begin(&directory,&root,"unsafe.pdf","job").is_err());
        std::fs::remove_dir_all(root).unwrap();
    }
}
