/*
 * Browser compatibility patch for FreeJ2ME, GPL-3.0-or-later.
 * JSR-82 L2CAPConnectionNotifier type, so MIDlets that declare fields or casts of it can load.
 */
package javax.bluetooth;

import java.io.IOException;
import javax.microedition.io.Connection;

public interface L2CAPConnectionNotifier extends Connection {
    L2CAPConnection acceptAndOpen() throws IOException;
}
