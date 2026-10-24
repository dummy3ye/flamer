use rayon::prelude::*;
use serde::{Deserialize, Serialize};
use std::fs;
use std::path::Path;
use std::time::Instant;

pub const PROTOCOL_VERSION: u32 = 1;

#[derive(Debug, Deserialize)]
pub struct Request {
    pub protocol: u32,
    pub operation: String,
    pub root: String,
    pub files: Vec<String>,
}

#[derive(Debug, Serialize)]
pub struct Response {
    pub protocol: u32,
    pub ok: bool,
    pub operation: String,
    pub metrics: Metrics,
    pub errors: Vec<FileError>,
    pub findings: Vec<Finding>,
    pub duration_ms: u128,
}

#[derive(Debug, Default, Serialize)]
pub struct Metrics {
    pub files: usize,
    pub bytes: u64,
    pub lines: u64,
}

#[derive(Debug, Serialize)]
pub struct FileError {
    pub path: String,
    pub message: String,
}

#[derive(Debug, Serialize)]
pub struct Finding {
    pub category: String,
    pub severity: String,
    pub title: String,
    pub detail: String,
    pub files: Vec<String>,
    pub lang: String,
}

pub fn process(request: Request) -> Response {
    let started = Instant::now();
    let mut metrics = Metrics::default();
    let mut errors = Vec::new();
    let mut findings = Vec::new();
    let operation = request.operation.clone();

    if request.protocol != PROTOCOL_VERSION {
        errors.push(FileError {
            path: String::new(),
            message: format!("unsupported protocol version {}", request.protocol),
        });
    } else if operation != "file_metrics" && operation != "rust_analysis" {
        errors.push(FileError {
            path: String::new(),
            message: format!("unsupported operation {operation}"),
        });
    } else {
        let results: Vec<_> = request
            .files
            .par_iter()
            .map(|relative| {
                let path = Path::new(&request.root).join(relative);
                match fs::read(&path) {
                    Ok(contents) => Ok((
                        relative.clone(),
                        contents.len() as u64,
                        contents.iter().filter(|byte| **byte == b'\n').count() as u64,
                        String::from_utf8_lossy(&contents).contains(".unwrap()"),
                    )),
                    Err(error) => {
                        Err(FileError { path: relative.clone(), message: error.to_string() })
                    }
                }
            })
            .collect();

        for result in results {
            match result {
                Ok((_relative, bytes, lines, _has_unwrap)) if operation == "file_metrics" => {
                    metrics.files += 1;
                    metrics.bytes += bytes;
                    metrics.lines += lines;
                }
                Ok((relative, _, _, true)) => findings.push(Finding {
                    category: "native".to_string(),
                    severity: "LOW".to_string(),
                    title: "Rust unwrap usage detected".to_string(),
                    detail: "Review unwrap calls on fallible paths and handle errors explicitly."
                        .to_string(),
                    files: vec![relative],
                    lang: "rust".to_string(),
                }),
                Ok(_) => {}
                Err(error) => errors.push(error),
            }
        }
    }

    Response {
        protocol: PROTOCOL_VERSION,
        ok: errors.is_empty(),
        operation,
        metrics,
        errors,
        findings,
        duration_ms: started.elapsed().as_millis(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn fixture(name: &str, contents: &[u8]) -> (String, String, std::path::PathBuf) {
        let path = std::env::temp_dir().join(format!("flamer-core-{}-{name}", std::process::id()));
        fs::write(&path, contents).expect("write fixture");
        let root = path.parent().expect("fixture parent").to_string_lossy().to_string();
        let file = path.file_name().expect("fixture name").to_string_lossy().to_string();
        (root, file, path)
    }

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
        let (root, file, path) = fixture("metrics.txt", b"one\ntwo\nthree");
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

    #[test]
    fn reports_rust_unwrap_usage() {
        let (root, file, path) = fixture("unwrap.rs", b"fn main() { let _ = result.unwrap(); }\n");
        let response = process(Request {
            protocol: PROTOCOL_VERSION,
            operation: "rust_analysis".to_string(),
            root,
            files: vec![file],
        });
        fs::remove_file(path).expect("remove fixture");
        assert!(response.ok);
        assert_eq!(response.findings.len(), 1);
        assert_eq!(response.findings[0].lang, "rust");
    }
}
