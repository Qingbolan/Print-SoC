// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    // Delegate to the library entrypoint where all commands/plugins are registered.
    print_at_soc_lib::run();
}
