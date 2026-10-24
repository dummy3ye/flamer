use std::io::{self, BufRead, Write};

use flamer_core::{process, Request, Response, PROTOCOL_VERSION};

fn error_response(message: String) -> Response {
    Response {
        protocol: PROTOCOL_VERSION,
        ok: false,
        operation: "unknown".to_string(),
        metrics: Default::default(),
        errors: vec![flamer_core::FileError { path: String::new(), message }],
        findings: vec![],
        duration_ms: 0,
    }
}

fn main() {
    let stdin = io::stdin();
    let mut stdout = io::BufWriter::new(io::stdout().lock());

    for line in stdin.lock().lines() {
        let response = match line {
            Ok(input) => match serde_json::from_str::<Request>(&input) {
                Ok(request) => process(request),
                Err(error) => error_response(format!("invalid request: {error}")),
            },
            Err(error) => error_response(format!("could not read request: {error}")),
        };
        serde_json::to_writer(&mut stdout, &response).expect("write response");
        stdout.write_all(b"\n").expect("write response newline");
        stdout.flush().expect("flush response");
    }
}
