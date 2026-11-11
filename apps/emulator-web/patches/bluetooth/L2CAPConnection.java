/*
 * Browser compatibility patch for FreeJ2ME, GPL-3.0-or-later.
 * JSR-82 L2CAPConnection type, so MIDlets that declare fields or casts of it can load.
 * The emulator never opens L2CAP connections (Connector rejects btl2cap:// URLs).
 */
package javax.bluetooth;

import java.io.IOException;
import javax.microedition.io.Connection;

public interface L2CAPConnection extends Connection {
    int DEFAULT_MTU = 672;
    int MINIMUM_MTU = 48;

    int getTransmitMTU() throws IOException;

    int getReceiveMTU() throws IOException;

    void send(byte[] data) throws IOException;

    int receive(byte[] inBuf) throws IOException;

    boolean ready() throws IOException;
}
