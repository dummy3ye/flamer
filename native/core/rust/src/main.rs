use serde::{Deserialize, Serialize};
use std::fs;
use std::io::{self, BufRead, Write};
use std::path::Path;
use std::time::Instant;

const PROTOCOL_VERSION: u32 = 1;

#[derive(Debug, Deserialize)]
struct Request {
    protocol: u32,
    operation: String,
    root: String,
    files: Vec<String>,
}

#[derive(Debug, Serialize)]
struct Response {
    protocol: u32,
    ok: bool,
    operation: String,
    metrics: Metrics,
    errors: Vec<FileError>,
    duration_ms: u128,
}

#[derive(Debug, Default, Serialize)]
struct Metrics {
    files: usize,
    bytes: u64,
    lines: u64,
}

#[derive(Debug, Serialize)]
struct FileError {
    path: String,
    message: String,
}

fn process(request: Request) -> Response {
    let started = Instant::now();
    let mut metrics = Metrics::default();
    let mut errors = Vec::new();

    if request.protocol != PROTOCOL_VERSION {
        errors.push(FileError {
            path: String::new(),
            message: format!("unsupported protocol version {}", request.protocol),
        });
    } else if request.operation != "file_metrics" {
        errors.push(FileError {
            path: String::new(),
            message: format!("unsupported operation {}", request.operation),
        });
    } else {
        for relative in request.files {
            let path = Path::new(&request.root).join(&relative);
            match fs::read(&path) {
                Ok(contents) => {
                    metrics.files += 1;
                    metrics.bytes += contents.len() as u64;
                    metrics.lines += contents.iter().filter(|byte| **byte == b'\n').count() as u64;
                }
                Err(error) => errors.push(FileError {
                    path: relative,
                    message: error.to_string(),
                }),
            }
        }
    }

    Response {
        protocol: PROTOCOL_VERSION,
        ok: errors.is_empty(),
        operation: "file_metrics".to_string(),
        metrics,
        errors,
        duration_ms: started.elapsed().as_millis(),
    }
}

fn main() {
    let stdin = io::stdin();
    let mut stdout = io::BufWriter::new(io::stdout().lock());

    for line in stdin.lock().lines() {
        let response = match line {
            Ok(input) => match serde_json::from_str::<Request>(&input) {
                Ok(request) => process(request),
                Err(error) => Response {
                    protocol: PROTOCOL_VERSION,
                    ok: false,
                    operation: "unknown".to_string(),
                    metrics: Metrics::default(),
                    errors: vec![FileError {
                        path: String::new(),
                        message: format!("invalid request: {error}"),
                    }],
                    duration_ms: 0,
                },
            },
            Err(error) => Response {
                protocol: PROTOCOL_VERSION,
                ok: false,
                operation: "unknown".to_string(),
                metrics: Metrics::default(),
                errors: vec![FileError {
                    path: String::new(),
                    message: format!("could not read request: {error}"),
                }],
                duration_ms: 0,
            },
        };

        serde_json::to_writer(&mut stdout, &response).expect("write response");
        stdout.write_all(b"\n").expect("write response newline");
        stdout.flush().expect("flush response");
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rejects_unknown_operations() {
        let response = process(Request {
            protocol: PROTOCOL_VERSION,
            operation: "unknown".to_string(),
            root: ".".to_string(),
            files: vec![],
        });

        assert!(!response.ok);
        assert!(response.errors[0].message.contains("unsupported operation"));
    }

    #[test]
    fn counts_newlines_and_bytes() {
        let path = std::env::temp_dir().join(format!("flamer-core-{}.txt", std::process::id()));
        fs::write(&path, b"one\ntwo\nthree").expect("write fixture");
        let root = path
            .parent()
            .expect("fixture parent")
            .to_string_lossy()
            .to_string();
        let file = path
            .file_name()
            .expect("fixture name")
            .to_string_lossy()
            .to_string();

        let response = process(Request {
            protocol: PROTOCOL_VERSION,
            operation: "file_metrics".to_string(),
            root,
            files: vec![file],
        });

        fs::remove_file(path).expect("remove fixture");
        assert!(response.ok);
        assert_eq!(response.metrics.files, 1);
        assert_eq!(response.metrics.bytes, 13);
        assert_eq!(response.metrics.lines, 2);
    }
}
