#[cfg(target_os = "linux")]
mod linux;

#[cfg(target_os = "linux")]
fn main() {
    use std::thread;
    use std::time::Duration;

    const FAILURE_EXIT_CODE: i32 = 1;
    const FAILURE_OBSERVABILITY_GRACE: Duration = Duration::from_secs(45);

    if let Err(error) = linux::run() {
        eprintln!("steel-manager-init failed: {error:#}");
        thread::sleep(FAILURE_OBSERVABILITY_GRACE);
        std::process::exit(FAILURE_EXIT_CODE);
    }
}

#[cfg(not(target_os = "linux"))]
fn main() -> Result<(), Box<dyn std::error::Error>> {
    Err("steel-manager-init requires Linux".into())
}
