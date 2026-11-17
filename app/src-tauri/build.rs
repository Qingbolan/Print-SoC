fn main() {
    for file in ["src/native_backend.rs", "src/native_wire.rs"] {
        println!("cargo:rerun-if-changed={file}");
    }
    let target = std::env::var("TARGET").unwrap();
    let output =
        std::path::PathBuf::from(std::env::var_os("OUT_DIR").unwrap()).join("printatsoc-backend");
    let status = std::process::Command::new(std::env::var_os("RUSTC").unwrap())
        .args([
            "--edition=2021",
            "--target",
            &target,
            "-C",
            "opt-level=s",
            "-C",
            "panic=abort",
            "-C",
            "strip=symbols",
            "-A",
            "dead_code",
            "src/native_backend.rs",
            "-o",
        ])
        .arg(output)
        .status()
        .expect("Build the standalone Rust CUPS backend");
    assert!(
        status.success(),
        "Standalone CUPS backend compilation failed"
    );
    tauri_build::build()
}
