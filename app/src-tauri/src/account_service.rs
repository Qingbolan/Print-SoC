//! The sole persisted account identity. Secrets remain in the OS credential store.
use crate::types::{ApiResponse, SSHAuthType, SSHConfig};
use std::path::PathBuf;

fn path() -> Result<PathBuf, String> {
    Ok(dirs::home_dir().ok_or("Home directory unavailable")?.join(".PrintAtSoC/account.json"))
}
pub fn save(config: &SSHConfig) -> Result<(), String> {
    remove_legacy_cli_identity(&path()?.with_file_name("virtual-printer.json"))?;
    write_identity(&path()?, Some(config))
}
fn write_identity(path: &std::path::Path, config: Option<&SSHConfig>) -> Result<(), String> {
    let identity = config.map(|config| { let mut identity = config.clone(); identity.auth_type = SSHAuthType::StoredPassword; identity });
    std::fs::create_dir_all(path.parent().unwrap()).map_err(|e| e.to_string())?;
    let mut file = tempfile::NamedTempFile::new_in(path.parent().unwrap()).map_err(|e| e.to_string())?;
    serde_json::to_writer(&mut file, &identity).map_err(|e| e.to_string())?;
    file.as_file().sync_all().map_err(|e| e.to_string())?;
    file.persist(path).map_err(|e| e.to_string())?;
    Ok(())
}
fn remove_legacy_cli_identity(path: &std::path::Path) -> Result<(), String> {
    if !path.exists() { return Ok(()); }
    let mut value: serde_json::Value = serde_json::from_slice(&std::fs::read(path).map_err(|e| e.to_string())?).map_err(|e| e.to_string())?;
    if value.as_object_mut().and_then(|object| object.remove("ssh")).is_some() {
        let mut file = tempfile::NamedTempFile::new_in(path.parent().unwrap()).map_err(|e| e.to_string())?;
        serde_json::to_writer(&mut file, &value).map_err(|e| e.to_string())?;
        file.as_file().sync_all().map_err(|e| e.to_string())?;
        file.persist(path).map_err(|e| e.to_string())?;
    }
    Ok(())
}
pub fn remove(config: &SSHConfig) -> Result<(), String> {
    let path = path()?;
    if path.exists() {
        let current: Option<SSHConfig> = serde_json::from_slice(&std::fs::read(&path).map_err(|e| e.to_string())?).map_err(|e| e.to_string())?;
        if current.is_some_and(|current| current.host == config.host && current.port == config.port && current.username == config.username) {
            write_identity(&path, None)?;
        }
    }
    Ok(())
}
#[tauri::command]
pub fn account_current(legacy_frontend: Option<SSHConfig>) -> ApiResponse<Option<SSHConfig>> {
    let result = (|| -> Result<Option<SSHConfig>, String> {
        let path = path()?;
        if !path.exists() {
            // Only the explicitly supplied frontend identity is migrated. Never
            // import credentials from legacy CLI or privileged CUPS snapshots.
            if let Some(config) = legacy_frontend { save(&config)?; } else { return Ok(None); }
        }
        remove_legacy_cli_identity(&path.with_file_name("virtual-printer.json"))?;
        let mut config: Option<SSHConfig> = serde_json::from_slice(&std::fs::read(path).map_err(|e| e.to_string())?).map_err(|e| e.to_string())?;
        if let Some(config) = config.as_mut() { config.auth_type = SSHAuthType::StoredPassword; }
        Ok(config)
    })();
    match result { Ok(value) => ApiResponse::success(value), Err(error) => ApiResponse::error(error) }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn legacy_cli_secrets_are_removed_without_changing_printer_preferences() {
        let directory = tempfile::tempdir().unwrap();
        let path = directory.path().join("virtual-printer.json");
        std::fs::write(&path, r#"{"ssh":{"username":"old-cli","password":"old-secret"},"print":{"printer":"psc008"}}"#).unwrap();
        remove_legacy_cli_identity(&path).unwrap();
        let value: serde_json::Value = serde_json::from_slice(&std::fs::read(path).unwrap()).unwrap();
        assert!(value.get("ssh").is_none());
        assert_eq!(value["print"]["printer"], "psc008");
    }
    #[test]
    fn identity_is_atomic_secret_free_and_deletion_is_a_tombstone() {
        let directory = tempfile::tempdir().unwrap();
        let path = directory.path().join("account.json");
        let config = SSHConfig { host: "stu.comp.nus.edu.sg".into(), port: 22,
            username: "test-user".into(), auth_type: SSHAuthType::Password { password: "secret-must-not-persist".into() } };
        write_identity(&path, Some(&config)).unwrap();
        let text = std::fs::read_to_string(&path).unwrap();
        assert!(!text.contains("secret-must-not-persist"));
        let identity: SSHConfig = serde_json::from_str(&text).unwrap();
        assert!(matches!(identity.auth_type, SSHAuthType::StoredPassword));
        write_identity(&path, None).unwrap();
        assert!(path.exists());
        assert_eq!(std::fs::read_to_string(path).unwrap(), "null");
    }
}
