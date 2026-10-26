// SPDX-License-Identifier: MIT
#import <Foundation/Foundation.h>
#include <obs.h>
#ifdef __cplusplus
extern "C" {
#endif
NSObject *cg_start_process_audio(obs_source_t *source, bool system, const char *application, const char *own);
void cg_stop_process_audio(NSObject *capture);
typedef void (*cg_pcm_callback)(void *, const struct obs_source_audio *);
NSObject *cg_start_application_pcm(const char *application, const char *own, cg_pcm_callback callback, void *context);
bool cg_application_pcm_failed(NSObject *capture);

#ifdef __cplusplus
}
#endif
