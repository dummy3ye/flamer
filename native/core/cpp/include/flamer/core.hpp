#pragma once

#include <cstdint>
#include <string>
#include <vector>

namespace flamer::core {

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

struct AnalysisResult {
  Metrics metrics;
  std::vector<std::string> errors;
  std::vector<Finding> findings;
};

AnalysisResult analyze_cpp(const std::string& root, const std::vector<std::string>& files);
std::string serialize_response(const AnalysisResult& result, std::uint64_t duration_ms);

}  // namespace flamer::core
