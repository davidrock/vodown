//! Native Messaging V1 handshake. This module deliberately cannot enqueue or
//! authorize downloads; those operations require a paired desktop session.
use serde::{Deserialize, Serialize};
use std::io::{self, ErrorKind, Read, Write};

pub const VERSION: u32 = 1;
// Limit both directions to Chrome's stricter host-to-browser maximum.
pub const MAX_FRAME: usize = 1024 * 1024;

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Request {
    pub version: u32,
    pub request_id: String,
    #[serde(rename = "type")]
    pub kind: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Response {
    pub version: u32,
    pub request_id: Option<String>,
    #[serde(rename = "type")]
    pub kind: &'static str,
    pub code: &'static str,
    pub capabilities: &'static [&'static str],
}

fn response(request_id: Option<String>, kind: &'static str, code: &'static str) -> Response {
    Response { version: VERSION, request_id, kind, code, capabilities: &[] }
}

pub fn handle(body: &[u8]) -> Response {
    let request: Request = match serde_json::from_slice(body) {
        Ok(value) => value,
        Err(_) => return response(None, "error", "invalid_message"),
    };
    if request.request_id.is_empty() || request.request_id.len() > 128
        || !request.request_id.bytes().all(|c| c.is_ascii_alphanumeric() || b"-_".contains(&c)) {
        return response(None, "error", "invalid_message");
    }
    let id = Some(request.request_id);
    if request.version != VERSION { return response(id, "error", "unsupported_version"); }
    match request.kind.as_str() {
        "hello" => Response { version: VERSION, request_id: id, kind:"hello", code:"desktop_not_connected", capabilities:&["handshake"] },
        _ => response(id, "error", "unsupported_operation"),
    }
}

pub fn valid_origin(origin: &str) -> bool {
    origin.strip_prefix("chrome-extension://").and_then(|v|v.strip_suffix('/'))
        .is_some_and(|id| id.len() == 32 && id.bytes().all(|c| (b'a'..=b'p').contains(&c)))
}

pub fn read_frame(reader: &mut impl Read) -> io::Result<Option<Vec<u8>>> {
    let mut header = [0u8; 4];
    let mut first = [0u8; 1];
    loop {
        match reader.read(&mut first) {
            Ok(0) => return Ok(None),
            Ok(_) => { header[0] = first[0]; break; }
            Err(error) if error.kind() == ErrorKind::Interrupted => continue,
            Err(error) => return Err(error),
        }
    }
    reader.read_exact(&mut header[1..])?;
    let length = u32::from_ne_bytes(header) as usize;
    if length == 0 || length > MAX_FRAME { return Err(io::Error::new(ErrorKind::InvalidData, "Invalid frame length")); }
    let mut body = vec![0; length];
    reader.read_exact(&mut body)?;
    Ok(Some(body))
}

pub fn write_frame(writer: &mut impl Write, message: &Response) -> io::Result<()> {
    let bytes = serde_json::to_vec(message).map_err(io::Error::other)?;
    if bytes.len() > MAX_FRAME { return Err(io::Error::new(ErrorKind::InvalidData, "Frame too large")); }
    writer.write_all(&(bytes.len() as u32).to_ne_bytes())?;
    writer.write_all(&bytes)?;
    writer.flush()
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Cursor;
    #[test]
    fn validates_framing_truncation_and_limits() {
        assert!(read_frame(&mut Cursor::new(vec![])).unwrap().is_none());
        assert_eq!(read_frame(&mut Cursor::new(vec![1,0])).unwrap_err().kind(), ErrorKind::UnexpectedEof);
        assert_eq!(read_frame(&mut Cursor::new((MAX_FRAME as u32 + 1).to_ne_bytes())).unwrap_err().kind(), ErrorKind::InvalidData);
        let mut input = (4u32).to_ne_bytes().to_vec(); input.extend_from_slice(b"ab");
        assert_eq!(read_frame(&mut Cursor::new(input)).unwrap_err().kind(), ErrorKind::UnexpectedEof);
    }
    #[test]
    fn rejects_unknown_operations_and_versions_without_leaking_input() {
        assert_eq!(handle(br#"{"version":1,"requestId":"a-1","type":"hello"}"#).code, "desktop_not_connected");
        assert_eq!(handle(br#"{"version":2,"requestId":"a-1","type":"hello"}"#).code, "unsupported_version");
        assert_eq!(handle(br#"{"version":1,"requestId":"a-1","type":"enqueue"}"#).code, "unsupported_operation");
        assert_eq!(handle(br#"{"version":1,"requestId":"token-secret","type":"hello","accessToken":"secret"}"#).code, "invalid_message");
        assert!(handle(br#"{"version":1,"requestId":"a-1","type":"hello","accessToken":"secret"}"#).request_id.is_none());
        assert!(valid_origin("chrome-extension://abcdefghijklmnopabcdefghijklmnop/"));
        assert!(!valid_origin("chrome-extension://abcdefghijklmnopabcdefghijklmnop.evil/"));
        assert!(!valid_origin("chrome-extension://abcdefghijklmnopabcdefghijklmnop"));
    }
    #[test]
    fn replies_are_valid_utf8_native_frames() {
        let mut bytes = Vec::new();
        write_frame(&mut bytes, &handle(br#"{"version":1,"requestId":"abc","type":"hello"}"#)).unwrap();
        let frame = read_frame(&mut Cursor::new(bytes)).unwrap().unwrap();
        let json: serde_json::Value = serde_json::from_slice(&frame).unwrap();
        assert_eq!(json["requestId"], "abc");
        assert_eq!(json["capabilities"][0], "handshake");
    }
}
