/*
 * Browser compatibility patch for FreeJ2ME, GPL-3.0-or-later.
 * Identity-only virtual adapter for MIDlets which query their device address.
 * The host supplies a persistent installation ID; no host hardware is accessed.
 */
package javax.bluetooth;

public class LocalDevice {
    private static LocalDevice device;
    private final String address;

    private LocalDevice(String address) {
        this.address = address;
    }

    public static synchronized LocalDevice getLocalDevice() throws BluetoothStateException {
        if (device == null) {
            String configured = System.getProperty("freej2me.bluetooth.address");
            if (configured == null || !configured.matches("[0-9a-fA-F]{12}")) {
                throw new BluetoothStateException("A persistent virtual device address is unavailable.");
            }
            device = new LocalDevice(configured.toUpperCase());
        }
        return device;
    }

    public static boolean isPowerOn() {
        try {
            return getLocalDevice() != null;
        } catch (BluetoothStateException unavailable) {
            return false;
        }
    }

    public String getBluetoothAddress() {
        return address;
    }
}
