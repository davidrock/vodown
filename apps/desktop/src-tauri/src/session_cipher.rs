use aes_gcm::{aead::{Aead, AeadCore, KeyInit, OsRng, Payload}, Aes256Gcm, Nonce};
pub const FAILURE: &str = "Não foi possível acessar a sessão no armazenamento seguro.";

pub fn encrypt(key: &[u8], account: &str, value: &str) -> Result<Vec<u8>, String> {
    let cipher = Aes256Gcm::new_from_slice(key).map_err(|_| FAILURE.to_string())?;
    let nonce = Aes256Gcm::generate_nonce(&mut OsRng);
    let ciphertext = cipher.encrypt(&nonce, Payload {msg:value.as_bytes(), aad:account.as_bytes()}).map_err(|_| FAILURE.to_string())?;
    let mut result = vec![1];
    result.extend_from_slice(&nonce);
    result.extend_from_slice(&ciphertext);
    Ok(result)
}
pub fn decrypt(key: &[u8], account: &str, value: &[u8]) -> Result<String, String> {
    if value.len() < 29 || value[0] != 1 { return Err(FAILURE.into()); }
    let cipher = Aes256Gcm::new_from_slice(key).map_err(|_| FAILURE.to_string())?;
    let plaintext = cipher.decrypt(Nonce::from_slice(&value[1..13]), Payload {msg:&value[13..],aad:account.as_bytes()}).map_err(|_| FAILURE.to_string())?;
    String::from_utf8(plaintext).map_err(|_| FAILURE.to_string())
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn large_sessions_round_trip_and_tampering_is_rejected() {
        let key = Aes256Gcm::generate_key(OsRng);
        let session = "private-session".repeat(2000);
        let mut ciphertext = encrypt(&key,"sb-project-auth-token", &session).unwrap();
        assert_eq!(decrypt(&key,"sb-project-auth-token",&ciphertext).unwrap(),session);
        assert!(decrypt(&key,"sb-other-auth-token",&ciphertext).is_err());
        assert!(decrypt(&Aes256Gcm::generate_key(OsRng),"sb-project-auth-token",&ciphertext).is_err());
        assert!(!ciphertext.windows(15).any(|w|w == b"private-session"));
        let last = ciphertext.len()-1; ciphertext[last] ^= 1;
        assert!(decrypt(&key,"sb-project-auth-token",&ciphertext).is_err());
        assert!(decrypt(&key,"sb-project-auth-token",&[]).is_err());
    }
}
