//! Passwords live only in the OS credential store, never in application settings.
use crate::types::{ApiResponse, SSHAuthType, SSHConfig};
use keyring::{Entry, Error};

const SERVICE: &str = "tech.silan.PrintAtSoC.ssh";

fn account_key(config: &SSHConfig) -> Result<String, String> {
    if config.username.trim().is_empty() || config.host.trim().is_empty() || config.port == 0 {
        return Err("A server, port and username are required for password storage".into());
    }
    // Structured encoding prevents collisions between usernames and host separators.
    serde_json::to_string(&(config.host.to_lowercase(), config.port, &config.username))
        .map_err(|_| "Invalid account identity".into())
}

fn entry(config: &SSHConfig) -> Result<Entry, String> {
    Entry::new(SERVICE, &account_key(config)?)
        .map_err(|_| "System password storage is unavailable".into())
}

struct PasswordStore(Entry);

impl PasswordStore {
    fn load(&self) -> Result<String, String> {
        self.0.get_password().map_err(|error| match error {
            Error::NoEntry => "Saved password not found. Enter your password again.".into(),
            _ => "Cannot access the system password store. Unlock it or enter your password again."
                .into(),
        })
    }

    fn save(&self, password: &str) -> Result<(), String> {
        if password.is_empty() {
            return Err("Cannot save an empty password".into());
        }
        self.0
            .set_password(password)
            .map_err(|_| "Could not save password in the system password store".into())
    }

    fn save_replacing(&self, password: &str, previous: Option<&PasswordStore>) -> Result<(), String> {
        let Some(previous) = previous else { return self.save(password); };
        // Preserve both identities until the replacement has been written.
        let prior_value = match self.0.get_password() {
            Ok(value) => Some(value),
            Err(Error::NoEntry) => None,
            Err(_) => return Err("Cannot read the replacement account's password store".into()),
        };
        self.save(password)?;
        if let Err(error) = previous.delete() {
            let rollback = match prior_value {
                Some(value) => self.save(&value),
                None => self.delete(),
            };
            return Err(if rollback.is_ok() { error } else {
                "Password replacement could not be completed or rolled back. Remove the extra account entry in the system password manager before retrying.".into()
            });
        }
        Ok(())
    }

    fn delete(&self) -> Result<(), String> {
        match self.0.delete_credential() {
            Ok(()) | Err(Error::NoEntry) => Ok(()),
            Err(_) => Err("Could not remove password from the system password store".into()),
        }
    }
}

pub fn load_password(config: &SSHConfig) -> Result<String, String> {
    PasswordStore(entry(config)?).load()
}

#[tauri::command]
pub async fn credential_save(config: SSHConfig, previous_config: Option<SSHConfig>) -> ApiResponse<bool> {
    let result = tauri::async_runtime::spawn_blocking(move || {
        let SSHAuthType::Password { ref password } = config.auth_type else {
            return Err("Enter a password before saving it".to_string());
        };
        let previous = match previous_config {
            Some(previous) if account_key(&previous)? != account_key(&config)? => Some(PasswordStore(entry(&previous)?)),
            _ => None,
        };
        PasswordStore(entry(&config)?).save_replacing(password, previous.as_ref())
    })
    .await;
    response(result)
}

#[tauri::command]
pub async fn credential_delete(config: SSHConfig) -> ApiResponse<bool> {
    let result =
        tauri::async_runtime::spawn_blocking(move || PasswordStore(entry(&config)?).delete()).await;
    response(result)
}

fn response(result: Result<Result<(), String>, tauri::Error>) -> ApiResponse<bool> {
    match result {
        Ok(Ok(())) => ApiResponse::success(true),
        Ok(Err(error)) => ApiResponse::error(error),
        Err(_) => ApiResponse::error("System password storage operation failed".into()),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn config(host: &str, username: &str, port: u16) -> SSHConfig {
        SSHConfig {
            host: host.into(),
            username: username.into(),
            port,
            auth_type: SSHAuthType::StoredPassword,
        }
    }

    #[test]
    fn password_lifecycle_and_failed_writes() {
        let store = PasswordStore(Entry::new_with_credential(Box::new(
            keyring::mock::MockCredential::default(),
        )));
        assert!(store.load().is_err());
        store.delete().unwrap();
        store.save("test-only-first").unwrap();
        assert_eq!(store.load().unwrap(), "test-only-first");
        assert!(store.save("").is_err());
        store.save("test-only-replacement").unwrap();
        assert_eq!(store.load().unwrap(), "test-only-replacement");
        let mock = store
            .0
            .get_credential()
            .downcast_ref::<keyring::mock::MockCredential>()
            .unwrap();
        mock.set_error(Error::Invalid("store".into(), "locked".into()));
        assert!(store.save("must-not-save").is_err());
        assert_eq!(store.load().unwrap(), "test-only-replacement");
        mock.set_error(Error::Invalid("store".into(), "locked".into()));
        assert!(store.delete().is_err());
        assert_eq!(store.load().unwrap(), "test-only-replacement");
        store.delete().unwrap();
        assert!(store.load().is_err());
        store.delete().unwrap();
    }

    #[test]
    fn failed_account_replacement_preserves_old_password_and_rolls_back_new() {
        let old = PasswordStore(Entry::new_with_credential(Box::new(keyring::mock::MockCredential::default())));
        let new = PasswordStore(Entry::new_with_credential(Box::new(keyring::mock::MockCredential::default())));
        old.save("old-value").unwrap();
        new.save("existing-new-value").unwrap();
        old.0.get_credential().downcast_ref::<keyring::mock::MockCredential>().unwrap()
            .set_error(Error::Invalid("store".into(), "locked".into()));
        assert!(new.save_replacing("replacement", Some(&old)).is_err());
        assert_eq!(old.load().unwrap(), "old-value");
        assert_eq!(new.load().unwrap(), "existing-new-value");
        new.save_replacing("replacement", Some(&old)).unwrap();
        assert!(old.load().is_err());
        assert_eq!(new.load().unwrap(), "replacement");
    }

    #[test]
    fn identity_is_scoped_to_server_port_and_user() {
        let base = account_key(&config("stu.comp.nus.edu.sg", "alice", 22)).unwrap();
        assert_eq!(
            base,
            account_key(&config("STU.COMP.NUS.EDU.SG", "alice", 22)).unwrap()
        );
        for other in [
            config("stf.comp.nus.edu.sg", "alice", 22),
            config("stu.comp.nus.edu.sg", "bob", 22),
            config("stu.comp.nus.edu.sg", "alice", 2222),
        ] {
            assert_ne!(base, account_key(&other).unwrap());
        }
        assert!(account_key(&config("", "alice", 22)).is_err());
    }
}
