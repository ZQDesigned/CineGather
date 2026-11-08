#pragma once
#include "network-diagnostics.hpp"
#include <atomic>
#include <chrono>
#include <cstdlib>
#include <cctype>
#include <curl/curl.h>
namespace cinegather {
inline int64_t tlsNativeCode(std::string_view error) {
  // Only Schannel's numeric status is allowed through. URLs/raw errors never survive.
  if (error.find("schannel") == std::string_view::npos &&
      error.find("Schannel") == std::string_view::npos)
    return -1;
  for (size_t pos = error.find("0x"); pos != std::string_view::npos;
       pos = error.find("0x", pos + 2)) {
    if (pos + 10 > error.size() ||
        (pos > 0 && error[pos - 1] != ' ' && error[pos - 1] != '(' && error[pos - 1] != ':'))
      continue;
    const auto digits = error.substr(pos + 2, 8);
    bool valid = true;
    for (char c : digits)
      if (!((c >= '0' && c <= '9') || (c >= 'a' && c <= 'f') || (c >= 'A' && c <= 'F')))
        valid = false;
    if (valid &&
        (pos + 10 == error.size() || !std::isxdigit(static_cast<unsigned char>(error[pos + 10]))))
      return std::strtoll(std::string(digits).c_str(), nullptr, 16);
  }
  return -1;
}
inline NetworkTrace collectCurlTrace(CURL *curl, CURLcode result, int method, const char *error,
                                     std::chrono::steady_clock::time_point start) {
  static std::atomic<int64_t> sequence{0};
  NetworkTrace r;
  r.set("sequence", ++sequence);
  r.set("method", method);
  r.set("curlCode", result);
  r.set("wallUs", std::chrono::duration_cast<std::chrono::microseconds>(
                      std::chrono::steady_clock::now() - start)
                      .count());
  auto number = [&](CURLINFO info, const char *key) {
    long value = 0;
    if (curl_easy_getinfo(curl, info, &value) == CURLE_OK)
      r.set(key, value);
  };
  number(CURLINFO_RESPONSE_CODE, "httpStatus");
  number(CURLINFO_OS_ERRNO, "osError");
  number(CURLINFO_REDIRECT_COUNT, "redirectCount");
  number(CURLINFO_NUM_CONNECTS, "connectCount");
  const auto *version = curl_version_info(CURLVERSION_NOW);
  std::string ssl = version && version->ssl_version ? version->ssl_version : "";
  int backend = ssl.find("Schannel") != std::string::npos          ? 1
                : ssl.find("SecureTransport") != std::string::npos ? 2
                : ssl.find("LibreSSL") != std::string::npos        ? 5
                : ssl.find("BoringSSL") != std::string::npos       ? 6
                : ssl.find("OpenSSL") != std::string::npos         ? 3
                : ssl.find("GnuTLS") != std::string::npos          ? 4
                                                                   : 0;
  r.set("tlsBackendCode", backend);
  // CURLINFO_SSL_VERIFYRESULT is only documented for OpenSSL/GnuTLS; zero on Schannel is not proof of certificate validation.
  if (backend == 3 || backend == 4 || backend == 5 || backend == 6)
    number(CURLINFO_SSL_VERIFYRESULT, "tlsVerifyResult");
  if (backend == 1 && error)
    r.set("tlsNativeCode", tlsNativeCode(error));
  char *ip = nullptr;
  if (curl_easy_getinfo(curl, CURLINFO_PRIMARY_IP, &ip) == CURLE_OK && ip && *ip)
    r.set("addressFamily", std::string_view(ip).find(':') == std::string_view::npos ? 4 : 6);
  for (const auto &p : std::array<std::pair<CURLINFO, const char *>, 6>{
           {{CURLINFO_NAMELOOKUP_TIME_T, "dnsUs"},
            {CURLINFO_CONNECT_TIME_T, "tcpUs"},
            {CURLINFO_APPCONNECT_TIME_T, "tlsUs"},
            {CURLINFO_PRETRANSFER_TIME_T, "requestReadyUs"},
            {CURLINFO_STARTTRANSFER_TIME_T, "firstByteUs"},
            {CURLINFO_TOTAL_TIME_T, "totalUs"}}}) {
    curl_off_t value = 0;
    if (curl_easy_getinfo(curl, p.first, &value) == CURLE_OK &&
        (value > 0 || std::string_view(p.second) == "totalUs"))
      r.set(p.second, value);
  }
  return r;
}
}
