#include <assert.h>
#include <string.h>
#include "libpostcssgo.h"
#include "handle_protocol.h"
int main(void) {
 unsigned int root = 0;
 unsigned int session = pcgoHandleParseV2("a{x:y}", 6, &root);
 assert(session && root);
 assert(pcgoHandleTypeV2(session, root) == HANDLE_NODE_ROOT);
 assert(pcgoHandleTypeV2(session, 0) == -1);
 int cursor = pcgoHandleOpenCursorV2(session, root, 1);
 unsigned int node = 0;
 assert(cursor >= 0 && pcgoHandleCursorNextV2(session, cursor, &node, 1) == 1);
 assert(pcgoHandleCloseCursorV2(session, cursor) == 0);
 pcgoHandleError snapshot_error = {0};
 int required = pcgoHandleReadSnapshotsV2_1(session, &node, 1, NULL, 0, &snapshot_error);
 assert(required > 0 && snapshot_error.code == HANDLE_STATUS_OK);
 char snapshot[4096] = {0};
 assert(required < (int)sizeof(snapshot));
 assert(pcgoHandleReadSnapshotsV2_1(session, &node, 1, snapshot, sizeof(snapshot)-1, &snapshot_error) == required);
 assert(strstr(snapshot, "\"prop\":\"x\"") && strstr(snapshot, "\"parent\":"));
 assert(pcgoHandleReadSnapshotsV2_1(session, &node, -1, NULL, 0, &snapshot_error) == -1);
 assert(snapshot_error.code == HANDLE_STATUS_INVALIDARGUMENT);
 pcgoHandleFreeErrorV2_1(&snapshot_error);
 assert(pcgoHandleReadSnapshotsV2_1(session, &node, HANDLE_MAX_BATCH_SIZE+1, NULL, 0, &snapshot_error) == -1);
 pcgoHandleFreeErrorV2_1(&snapshot_error);
 assert(pcgoHandleReadSnapshotsV2_1(session, NULL, 1, NULL, 0, &snapshot_error) == -1);
 pcgoHandleFreeErrorV2_1(&snapshot_error);
 pcgoHandleCloseV2(session);
 assert(pcgoHandleSessionCountV2() == 0);
 pcgoHandleError detail = {0};
 assert(pcgoHandleTypeV2_1(session, root, &detail) == -1);
 assert(detail.code == HANDLE_STATUS_CLOSED && detail.message && detail.length);
 pcgoHandleFreeErrorV2_1(&detail);
 assert(!detail.message && !detail.length);
 return 0;
}
