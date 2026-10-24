#include "flamer/core.hpp"

#include <chrono>
#include <iostream>
#include <string>

namespace {

std::string json_escape(const std::string& value) {
  std::string escaped;
  for (const char character : value) {
    switch (character) {
      case '\\': escaped += "\\\\"; break;
      case '"': escaped += "\\\""; break;
      case '\n': escaped += "\\n"; break;
      case '\r': escaped += "\\r"; break;
      case '\t': escaped += "\\t"; break;
      default: escaped += character;
    }
  }
  return escaped;
}

std::string extract_string(const std::string& input, const std::string& field) {
  const std::string marker = "\"" + field + "\":\"";
  const auto start = input.find(marker);
  if (start == std::string::npos) return {};
  std::string value;
  bool escaped = false;
  for (std::size_t i = start + marker.size(); i < input.size(); ++i) {
    if (escaped) {
      value += input[i];
      escaped = false;
    } else if (input[i] == '\\') {
      escaped = true;
    } else if (input[i] == '"') {
      break;
    } else {
      value += input[i];
    }
  }
  return value;
}

std::vector<std::string> extract_files(const std::string& input) {
  std::vector<std::string> files;
  const auto start = input.find("\"files\":[");
  if (start == std::string::npos) return files;
  std::size_t position = start + 9;
  while (position < input.size() && input[position] != ']') {
    if (input[position] == '"') {
      const auto end = input.find('"', position + 1);
      if (end == std::string::npos) break;
      files.push_back(input.substr(position + 1, end - position - 1));
      position = end + 1;
    } else {
      ++position;
    }
  }
  return files;
}

std::string response_json(const flamer::core::AnalysisResult& result, std::uint64_t duration_ms) {
  std::string output = "{\"protocol\":1,\"ok\":" + std::string(result.errors.empty() ? "true" : "false") +
      ",\"operation\":\"cpp_analysis\",\"metrics\":{\"files\":" +
      std::to_string(result.metrics.files) + ",\"bytes\":" + std::to_string(result.metrics.bytes) +
      ",\"lines\":" + std::to_string(result.metrics.lines) + "},\"errors\":[";
  for (std::size_t i = 0; i < result.errors.size(); ++i) {
    if (i) output += ',';
    output += "{\"path\":\"\",\"message\":\"" + json_escape(result.errors[i]) + "\"}";
  }
  output += "],\"findings\":[";
  for (std::size_t i = 0; i < result.findings.size(); ++i) {
    if (i) output += ',';
    const auto& finding = result.findings[i];
    output += "{\"category\":\"native\",\"severity\":\"LOW\",\"title\":\"" +
        json_escape(finding.title) + "\",\"detail\":\"" + json_escape(finding.detail) +
        "\",\"files\":[\"" + json_escape(finding.file) + "\"],\"lang\":\"cpp\"}";
  }
  return output + "],\"duration_ms\":" + std::to_string(duration_ms) + "}";
}

}  // namespace

int main() {
  std::string input;
  while (std::getline(std::cin, input)) {
    const auto started = std::chrono::steady_clock::now();
    const auto root = extract_string(input, "root");
    const auto files = extract_files(input);
    const auto result = flamer::core::analyze_cpp(root, files);
    const auto elapsed = std::chrono::duration_cast<std::chrono::milliseconds>(
        std::chrono::steady_clock::now() - started);
    std::cout << response_json(result, static_cast<std::uint64_t>(elapsed.count())) << '\n' << std::flush;
  }
}
