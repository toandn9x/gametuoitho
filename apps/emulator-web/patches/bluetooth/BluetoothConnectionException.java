/*
 * Browser compatibility patch for FreeJ2ME, GPL-3.0-or-later.
 * JSR-82 BluetoothConnectionException with the public API of the specification.
 * The bundled class had only package-private constructors and no status codes.
 */
package javax.bluetooth;

import java.io.IOException;

public class BluetoothConnectionException extends IOException {
    public static final int UNKNOWN_PSM = 0x0001;
    public static final int SECURITY_BLOCK = 0x0002;
    public static final int NO_RESOURCES = 0x0003;
    public static final int FAILED_NOINFO = 0x0004;
    public static final int TIMEOUT = 0x0005;
    public static final int UNACCEPTABLE_PARAMS = 0x0006;

    private final int status;

    public BluetoothConnectionException(int error) {
        this(error, null);
    }

    public BluetoothConnectionException(int error, String msg) {
        super(msg);
        if (error < UNKNOWN_PSM || error > UNACCEPTABLE_PARAMS) {
            throw new IllegalArgumentException("error is not a valid status code");
        }
        this.status = error;
    }

    // Kept from the bundled class for source compatibility.
    public BluetoothConnectionException() {
        this(FAILED_NOINFO, null);
    }

    public BluetoothConnectionException(String msg) {
        this(FAILED_NOINFO, msg);
    }

    public int getStatus() {
        return status;
    }
}
