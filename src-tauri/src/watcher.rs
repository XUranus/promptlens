use notify::{Event, EventKind, RecommendedWatcher, RecursiveMode, Watcher};
use std::path::PathBuf;
use std::sync::mpsc;
use std::time::Duration;
use tauri::Emitter;

pub struct FileWatcher {
    _watcher: RecommendedWatcher,
    path: PathBuf,
}

impl FileWatcher {
    pub fn start(path: PathBuf, app: tauri::AppHandle) -> Result<Self, String> {
        let (tx, rx) = mpsc::channel::<notify::Result<Event>>();
        let watch_path = path.clone();

        let mut watcher = RecommendedWatcher::new(
            tx,
            notify::Config::default().with_poll_interval(Duration::from_millis(500)),
        )
        .map_err(|e| format!("Failed to create file watcher: {e}"))?;

        watcher
            .watch(&watch_path, RecursiveMode::NonRecursive)
            .map_err(|e| format!("Failed to watch file: {e}"))?;

        let watched_path = path.clone();
        std::thread::spawn(move || {
            let mut last_emit = std::time::Instant::now();
            let debounce = Duration::from_millis(500);

            while let Ok(event_result) = rx.recv() {
                let Ok(event) = event_result else { continue };
                match event.kind {
                    EventKind::Modify(_) | EventKind::Create(_) => {
                        let now = std::time::Instant::now();
                        if now.duration_since(last_emit) >= debounce {
                            last_emit = now;
                            let _ = app
                                .emit("file-changed", watched_path.to_string_lossy().to_string());
                        }
                    }
                    _ => {}
                }
            }
        });

        Ok(Self {
            _watcher: watcher,
            path,
        })
    }

    pub fn path(&self) -> &std::path::Path {
        &self.path
    }
}
