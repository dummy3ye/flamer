#include "flamer/core.hpp"

#include <filesystem>
#include <fstream>

namespace flamer::core {

AnalysisResult analyze_cpp(const std::string& root, const std::vector<std::string>& files) {
  AnalysisResult result;
  for (const auto& relative : files) {
    std::ifstream file(std::filesystem::path(root) / relative);
    if (!file) {
      result.errors.push_back("could not read " + relative);
      continue;
    }
    ++result.metrics.files;
    std::string line;
    while (std::getline(file, line)) {
      result.metrics.bytes += line.size() + 1;
      ++result.metrics.lines;
      if (line.find("#include <bits/stdc++.h>") != std::string::npos) {
        result.findings.push_back({
            "Non-portable umbrella include",
            "Replace bits/stdc++.h with explicit standard headers.",
            relative,
        });
      }
    }
  }
  return result;
}

}  // namespace flamer::core
