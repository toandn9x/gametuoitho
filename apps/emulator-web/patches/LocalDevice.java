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

    // The rest of the JSR-82 LocalDevice API. Multiplayer MIDlets (e.g. Art Of War 2 Bluetooth) call
    // these; without them they stopped with NoSuchMethodError. There is no Bluetooth networking:
    // searches find nothing (see DiscoveryAgent) and hosting a game fails as with Bluetooth switched off.
    private static DiscoveryAgent agent;

    public DiscoveryAgent getDiscoveryAgent() {
        synchronized (LocalDevice.class) {
            if (agent == null) {
                agent = new DiscoveryAgent();
            }
            return agent;
        }
    }

    public String getFriendlyName() {
        return "Game Tuoi Tho";
    }

    public DeviceClass getDeviceClass() {
        return new DeviceClass(0x00020C); // major class Phone, minor class Smart phone
    }

    public boolean setDiscoverable(int mode) throws BluetoothStateException {
        if (mode != DiscoveryAgent.NOT_DISCOVERABLE && (mode < 0x9E8B00 || mode > 0x9E8B3F)) {
            throw new IllegalArgumentException("Invalid discoverable mode.");
        }
        if (mode == DiscoveryAgent.NOT_DISCOVERABLE) {
            return true;
        }
        throw new BluetoothStateException("Bluetooth networking is not available in the browser emulator.");
    }

    public int getDiscoverable() {
        return DiscoveryAgent.NOT_DISCOVERABLE;
    }

    public static String getProperty(String property) {
        if ("bluetooth.api.version".equals(property)) {
            return "1.1";
        }
        if ("bluetooth.connected.devices.max".equals(property)) {
            return "0";
        }
        return null;
    }

    public ServiceRecord getRecord(javax.microedition.io.Connection notifier) {
        if (notifier == null) {
            throw new NullPointerException("notifier is null");
        }
        throw new IllegalArgumentException("Not a Bluetooth service notifier of this device.");
    }

    public void updateRecord(ServiceRecord srvRecord) throws ServiceRegistrationException {
        if (srvRecord == null) {
            throw new NullPointerException("srvRecord is null");
        }
        throw new ServiceRegistrationException("Bluetooth service registration is not available in the browser emulator.");
    }
}
