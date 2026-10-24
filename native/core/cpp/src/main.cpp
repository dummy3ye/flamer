#include <chrono>
#include <cstdint>
#include <filesystem>
#include <fstream>
#include <iostream>
#include <string>
#include <vector>

namespace {
constexpr std::uint32_t protocol_version = 1;

struct Metrics {
  std::size_t files = 0;
  std::uint64_t bytes = 0;
  std::uint64_t lines = 0;
};

struct Finding {
  std::string title;
  std::string detail;
  std::string file;
};

std::string json_escape(const std::string& value) {
  std::string escaped;
  for (const char character : value) {
    switch (character) {
      case '\\':
        escaped += "\\\\";
        break;
      case '"':
        escaped += "\\\"";
        break;
      case '\n':
        escaped += "\\n";
        break;
      case '\r':
        escaped += "\\r";
        break;
      case '\t':
        escaped += "\\t";
        break;
      default:
        escaped += character;
    }
  }
  return escaped;
}

std::string json_string(const std::string& input, std::size_t start) {
  std::string value;
  bool escaped = false;
  for (std::size_t i = start; i < input.size(); ++i) {
    const char character = input[i];
    if (escaped) {
      value += character == 'n' ? '\n' : character == 'r' ? '\r' : character == 't' ? '\t' : character;
      escaped = false;
    } else if (character == '\\') {
      escaped = true;
    } else if (character == '"') {
      break;
    } else {
      value += character;
    }
  }
  return value;
}

bool field_string(const std::string& input, const std::string& field, std::string& value) {
  const std::string marker = "\"" + field + "\":\"";
  const std::size_t position = input.find(marker);
  if (position == std::string::npos) return false;
  value = json_string(input, position + marker.size());
  return true;
}

std::vector<std::string> field_array(const std::string& input, const std::string& field) {
  std::vector<std::string> values;
  const std::string marker = "\"" + field + "\":[";
  const std::size_t start = input.find(marker);
  if (start == std::string::npos) return values;
  std::size_t position = start + marker.size();
  while (position < input.size() && input[position] != ']') {
    if (input[position] == '"') {
      values.push_back(json_string(input, position + 1));
      position = input.find('"', position + 1);
      if (position == std::string::npos) break;
    }
    ++position;
  }
  return values;
}

void respond(bool ok, const Metrics& metrics, const std::vector<std::string>& errors,
             const std::vector<Finding>& findings, const std::string& operation,
             std::uint64_t duration_ms) {
  std::cout << "{\"protocol\":" << protocol_version << ",\"ok\":" << (ok ? "true" : "false")
            << ",\"operation\":\"" << operation << "\",\"metrics\":{\"files\":" << metrics.files
            << ",\"bytes\":" << metrics.bytes << ",\"lines\":" << metrics.lines << "},\"errors\":[";
  for (std::size_t i = 0; i < errors.size(); ++i) {
    if (i > 0) std::cout << ',';
    std::cout << "{\"path\":\"\",\"message\":\"" << json_escape(errors[i]) << "\"}";
  }
  std::cout << "],\"findings\":[";
  for (std::size_t i = 0; i < findings.size(); ++i) {
    if (i > 0) std::cout << ',';
    std::cout << "{\"category\":\"native\",\"severity\":\"LOW\",\"title\":\"" << json_escape(findings[i].title)
              << "\",\"detail\":\"" << json_escape(findings[i].detail) << "\",\"files\":[\""
              << json_escape(findings[i].file) << "\"],\"lang\":\"cpp\"}";
  }
  std::cout << "],\"duration_ms\":" << duration_ms << "}\n" << std::flush;
}

}  // namespace

int main() {
  std::string input;
  while (std::getline(std::cin, input)) {
    const auto started = std::filesystem::file_time_type::clock::now();
    Metrics metrics;
    std::vector<std::string> errors;
    std::vector<Finding> findings;
    std::string root;
    const auto files = field_array(input, "files");

    if (input.find("\"protocol\":1") == std::string::npos) {
      errors.emplace_back("unsupported protocol version");
    } else if (input.find("\"operation\":\"cpp_analysis\"") == std::string::npos) {
      errors.emplace_back("unsupported operation");
    } else if (!field_string(input, "root", root)) {
      errors.emplace_back("missing root");
    } else {
      for (const auto& relative : files) {
        std::ifstream file(std::filesystem::path(root) / relative);
        std::string line;
        while (std::getline(file, line)) {
          if (line.find("#include <bits/stdc++.h>") != std::string::npos) {
            findings.push_back({"Non-portable umbrella include", "Replace bits/stdc++.h with explicit standard headers.", relative});
            break;
          }
        }
      }
    }

    const auto elapsed = std::filesystem::file_time_type::clock::now() - started;
    const auto duration_ms =
        static_cast<std::uint64_t>(std::chrono::duration_cast<std::chrono::milliseconds>(elapsed).count());
    respond(errors.empty(), metrics, errors, findings, "cpp_analysis", duration_ms);
  }
}
