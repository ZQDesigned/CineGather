#include "../curl-network-diagnostics.hpp"
#include <cassert>
#include <iostream>
#include <string>
int main(int argc, char **argv) {
  using namespace cinegather;
  assert(tlsNativeCode("schannel: error 0x80092013 https://secret/token") == 0x80092013LL);
  assert(tlsNativeCode("https://secret/0x80092013") == -1);
  if (argc == 1) {
    NetworkTrace trace;
    trace.set("sequence", 1);
    trace.set("method", 1);
    trace.set("curlCode", 28);
    trace.set("httpStatus", 0);
    trace.set("wallUs", 8000000);
    const auto json = trace.json();
    assert(json.find("secret") == std::string::npos);
    auto parsed = NetworkTrace::parse(json);
    assert(parsed && parsed->get("curlCode") == 28);
    assert(!NetworkTrace::parse("{\"url\":\"https://private\"}"));
    assert(!NetworkTrace::parse(json.substr(0, json.size() - 1) + ",\"curlCode\":0}"));
    NetworkTelemetry telemetry;
    assert(telemetry.consume("[WHIP] CG_WHIP_HTTP " + json));
    trace.set("sequence", 2);
    trace.set("method", 2);
    trace.set("curlCode", 0);
    trace.set("httpStatus", 200);
    assert(telemetry.consume("CG_WHIP_HTTP " + trace.json()));
    assert(telemetry.connection()->get("curlCode") == 28);
    assert(telemetry.cleanup()->get("curlCode") == 0);
    assert(!telemetry.consume("CG_WHIP_HTTP https://private"));
    return 0;
  }
  CURL *curl = curl_easy_init();
  assert(curl);
  char error[CURL_ERROR_SIZE] = {};
  curl_easy_setopt(curl, CURLOPT_URL, argv[1]);
  curl_easy_setopt(curl, CURLOPT_ERRORBUFFER, error);
  curl_easy_setopt(curl, CURLOPT_NOPROXY, "*");
  curl_easy_setopt(curl, CURLOPT_TIMEOUT_MS,
                   argc > 2 && std::string(argv[2]) == "timeout" ? 100L : 1000L);
  curl_easy_setopt(
      curl, CURLOPT_WRITEFUNCTION, +[](char *, size_t a, size_t b, void *) { return a * b; });
  const auto start = std::chrono::steady_clock::now();
  const auto result = curl_easy_perform(curl);
  auto trace = collectCurlTrace(curl, result, 1, error, start);
  curl_easy_cleanup(curl);
  if (argc > 2) {
    const int expected = std::string(argv[2]) == "timeout" ? 28 : std::atoi(argv[2]);
    assert(int(result) == expected);
    assert(trace.get("curlCode") == expected);
    assert(trace.get("firstByteUs") <= 0);
  } else {
    assert(result == CURLE_OK);
    assert(trace.get("httpStatus") == 201);
    assert(trace.get("addressFamily") == 4);
    assert(trace.get("totalUs") > 0);
  }
  std::cout << trace.json() << "\n";
}
