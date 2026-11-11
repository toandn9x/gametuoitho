/*
 * Browser compatibility patch for FreeJ2ME, GPL-3.0-or-later.
 * JSR-82 BluetoothStateException with public constructors (the bundled ones were package-private).
 */
package javax.bluetooth;

import java.io.IOException;

public class BluetoothStateException extends IOException {
    public BluetoothStateException() {
        super();
    }

    public BluetoothStateException(String msg) {
        super(msg);
    }
}
