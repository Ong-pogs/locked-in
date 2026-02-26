import "react-native-get-random-values";
import { Buffer } from "buffer";
global.Buffer = Buffer;

// Anchor subarray polyfill – some RN environments lack Buffer.prototype.subarray
if (!Buffer.prototype.subarray) {
  Buffer.prototype.subarray = function (begin, end) {
    const result = Uint8Array.prototype.slice.call(this, begin, end);
    Object.setPrototypeOf(result, Buffer.prototype);
    return result;
  };
}

import { registerRootComponent } from "expo";
import App from "./App";

registerRootComponent(App);
