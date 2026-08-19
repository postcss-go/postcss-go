#ifndef LIBPOSTCSSGO_H
#define LIBPOSTCSSGO_H

#ifdef __cplusplus
extern "C" {
#endif

extern int pcgoCall(
    unsigned char operation, char* first, int firstLen, char* second, int secondLen,
    char* outBuf, int outCap, char* errBuf, int errCap);
extern unsigned int pcgoHandleParse(char* buf, int length);
extern void pcgoHandleClose(void);
extern int pcgoHandleType(unsigned int handle);
extern int pcgoHandleGetField(unsigned int handle, int field, char* buf, int capacity);
extern int pcgoHandleSetField(unsigned int handle, int field, char* buf, int length);
extern int pcgoHandleWalkDecls(unsigned int root, unsigned int* out, int capacity);
extern int pcgoHandleOpenCursor(unsigned int root, int declsOnly);
extern int pcgoHandleCursorNext(int id, unsigned int* out, int capacity);
extern int pcgoHandleCloseCursor(int id);
extern int pcgoHandleReadFields(
    unsigned int* handles, int count, int field, char* buf, int capacity);
extern int pcgoHandleSetFields(
    unsigned int* handles, int count, int field, char* buf, int length);
extern unsigned int pcgoHandleNewDecl(char* prop, int propLen, char* value, int valueLen);
extern int pcgoHandleAppend(unsigned int parent, unsigned int child);
extern int pcgoHandleDispose(unsigned int handle);
extern int pcgoHandleStringify(unsigned int handle, char* buf, int capacity);

#ifdef __cplusplus
}
#endif

#endif
