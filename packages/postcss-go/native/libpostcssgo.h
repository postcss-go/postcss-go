#ifndef LIBPOSTCSSGO_H
#define LIBPOSTCSSGO_H

#ifdef __cplusplus
extern "C" {
#endif

#ifndef PCGO_HANDLE_ERROR_H
#define PCGO_HANDLE_ERROR_H
typedef struct { unsigned int code; char* message; size_t length; } pcgoHandleError;
#endif

extern int pcgoCall(
    unsigned char operation, char* first, int firstLen, char* second, int secondLen,
    char* outBuf, int outCap, char* errBuf, int errCap);
extern unsigned int pcgoHandleParse(
    char* buf, int length, unsigned int* rootOut, char* optionsJSON, int optionsLength,
    pcgoHandleError* errorOut);
extern void pcgoHandleClose(unsigned int id);
extern unsigned int pcgoHandleSessionCount(void);
extern void pcgoHandleFreeError(pcgoHandleError* out);
extern int pcgoHandleType(unsigned int sessionID, unsigned int handle, pcgoHandleError* errorOut);
extern unsigned int pcgoHandleOpenCursor(
    unsigned int sessionID, unsigned int root, int declsOnly, pcgoHandleError* errorOut);
extern int pcgoHandleCursorNext(
    unsigned int sessionID, unsigned int id, unsigned int* out, int capacity,
    pcgoHandleError* errorOut);
extern int pcgoHandleCloseCursor(unsigned int sessionID, unsigned int id, pcgoHandleError* errorOut);
extern int pcgoHandleReadSnapshots(
    unsigned int sessionID, unsigned int* handles, int count, char* buf, int capacity,
    pcgoHandleError* errorOut);

#ifdef __cplusplus
}
#endif

#endif
