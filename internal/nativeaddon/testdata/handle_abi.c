#include <assert.h>
#include <string.h>
#include "libpostcssgo.h"
#include "handle_protocol.h"
int main(void) {
  unsigned int root = 0;
  pcgoHandleError err = {0};
  unsigned int session = pcgoHandleParse("a{x:y}", 6, &root, NULL, 0, &err);
  assert(session && root);
  assert(pcgoHandleType(session, root, &err) == HANDLE_NODE_ROOT);
  assert(pcgoHandleType(session, 0, &err) == -1);
  unsigned int cursor = pcgoHandleOpenCursor(session, root, 1, &err);
  unsigned int node = 0;
  assert(cursor && pcgoHandleCursorNext(session, cursor, &node, 1, &err) == 1);
  assert(pcgoHandleCloseCursor(session, cursor, &err) == 0);
  pcgoHandleError snapshot_error = {0};
  int required = pcgoHandleReadSnapshots(session, &node, 1, NULL, 0, &snapshot_error);
  assert(required > 0 && snapshot_error.code == HANDLE_STATUS_OK);
  char snapshot[4096] = {0};
  assert(required < (int)sizeof(snapshot));
  assert(pcgoHandleReadSnapshots(session, &node, 1, snapshot, sizeof(snapshot)-1, &snapshot_error) == required);
  assert(strstr(snapshot, "\"prop\":\"x\"") && strstr(snapshot, "\"parent\":"));
  assert(pcgoHandleReadSnapshots(session, &node, -1, NULL, 0, &snapshot_error) == -1);
  assert(snapshot_error.code == HANDLE_STATUS_INVALIDARGUMENT);
  pcgoHandleFreeError(&snapshot_error);
  assert(pcgoHandleReadSnapshots(session, &node, HANDLE_MAX_BATCH_SIZE+1, NULL, 0, &snapshot_error) == -1);
  pcgoHandleFreeError(&snapshot_error);
  assert(pcgoHandleReadSnapshots(session, NULL, 1, NULL, 0, &snapshot_error) == -1);
  pcgoHandleFreeError(&snapshot_error);
  pcgoHandleClose(session);
  assert(pcgoHandleSessionCount() == 0);
  pcgoHandleError detail = {0};
  assert(pcgoHandleType(session, root, &detail) == -1);
  assert(detail.code == HANDLE_STATUS_CLOSED && detail.message && detail.length);
  pcgoHandleFreeError(&detail);
  assert(!detail.message && !detail.length);
  return 0;
}
