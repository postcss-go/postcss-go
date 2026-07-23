"use strict";
const bridge_1 = require("./bridge");
// Go returns a UTF-16 token snapshot; this wrapper only preserves PostCSS's
// cursor, back-stack, and lazy error-handling contract.
function tokenizer(input, options = {}) {
    const css = input.css.valueOf();
    let snapshot;
    let index = 0;
    let currentPosition = 0;
    const returned = [];
    function load() {
        snapshot = (0, bridge_1.call)('tokenize', {
            css,
            file: input.file || '',
            options: { ignoreErrors: Boolean(options.ignoreErrors) },
            ignoreUnclosed: false,
        });
        index = 0;
        currentPosition = 0;
    }
    function positionOf(indexToRead) {
        if (indexToRead <= 0)
            return 0;
        const position = snapshot.positions[indexToRead - 1];
        return position === undefined ? currentPosition : position;
    }
    function position() {
        return currentPosition;
    }
    function endOfFile() {
        if (!snapshot)
            load();
        return (returned.length === 0 &&
            snapshot !== undefined &&
            index >= snapshot.tokens.length &&
            !snapshot.error);
    }
    function nextToken(opts) {
        if (returned.length)
            return returned.pop();
        if (!snapshot)
            load();
        if (snapshot.error && index === snapshot.errorIndex) {
            if (opts && opts.ignoreUnclosed) {
                snapshot.error = undefined;
                currentPosition = positionOf(index);
            }
            else {
                throw (0, bridge_1.errorFromPayload)(snapshot.error);
            }
        }
        if (index >= snapshot.tokens.length)
            return;
        const token = snapshot.tokens[index++];
        currentPosition = positionOf(index);
        return token;
    }
    function back(token) {
        returned.push(token);
    }
    return { back, endOfFile, nextToken, position };
}
module.exports = tokenizer;
