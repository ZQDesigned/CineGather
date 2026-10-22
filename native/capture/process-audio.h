// SPDX-License-Identifier: MIT
#import <Foundation/Foundation.h>
#include <obs.h>
#ifdef __cplusplus
extern "C" {
#endif
NSObject *cg_start_process_audio(obs_source_t *source, bool system, const char *application, const char *own);
void cg_stop_process_audio(NSObject *capture);

#ifdef __cplusplus
}
#endif
