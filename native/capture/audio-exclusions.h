// SPDX-License-Identifier: MIT
#pragma once
#include <stdbool.h>
#include <string.h>
static inline bool cg_audio_bundle_family(const char *bundle, const char *family) {
  if (!bundle || !family || !*family) return false;
  size_t length = strlen(family);
  return strncmp(bundle, family, length) == 0 &&
         (bundle[length] == '\0' || bundle[length] == '.');
}
static inline bool cg_audio_bundle_is_excluded(const char *bundle, const char *own) {
  return cg_audio_bundle_family(bundle, "city.zqdesigned.cinegather") ||
         cg_audio_bundle_family(bundle, own);
}
