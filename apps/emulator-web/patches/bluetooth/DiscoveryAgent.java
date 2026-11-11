/*
 * Browser compatibility patch for FreeJ2ME, GPL-3.0-or-later.
 * JSR-82 DiscoveryAgent for an emulator without Bluetooth networking: every inquiry and service
 * search completes normally with nothing found, as on a phone with no other device in range.
 * Results are delivered on a separate thread, like a real Bluetooth stack.
 */
package javax.bluetooth;

public class DiscoveryAgent {
    public static final int NOT_DISCOVERABLE = 0;
    public static final int GIAC = 0x9E8B33;
    public static final int LIAC = 0x9E8B00;
    public static final int CACHED = 0x00;
    public static final int PREKNOWN = 0x01;

    private static int nextTransactionId = 1;

    DiscoveryAgent() {
    }

    public RemoteDevice[] retrieveDevices(int option) {
        if (option != CACHED && option != PREKNOWN) {
            throw new IllegalArgumentException("option must be CACHED or PREKNOWN");
        }
        return null;
    }

    public boolean startInquiry(int accessCode, final DiscoveryListener listener) throws BluetoothStateException {
        if (listener == null) {
            throw new NullPointerException("listener is null");
        }
        later(new Runnable() {
            public void run() {
                listener.inquiryCompleted(DiscoveryListener.INQUIRY_COMPLETED);
            }
        });
        return true;
    }

    public boolean cancelInquiry(DiscoveryListener listener) {
        if (listener == null) {
            throw new NullPointerException("listener is null");
        }
        return false;
    }

    public int searchServices(int[] attrSet, UUID[] uuidSet, RemoteDevice btDev, final DiscoveryListener discListener)
            throws BluetoothStateException {
        if (uuidSet == null || btDev == null || discListener == null) {
            throw new NullPointerException("uuidSet, btDev and discListener are required");
        }
        final int transId;
        synchronized (DiscoveryAgent.class) {
            transId = nextTransactionId++;
        }
        later(new Runnable() {
            public void run() {
                discListener.serviceSearchCompleted(transId, DiscoveryListener.SERVICE_SEARCH_DEVICE_NOT_REACHABLE);
            }
        });
        return transId;
    }

    public boolean cancelServiceSearch(int transID) {
        return false;
    }

    public String selectService(UUID uuid, int security, boolean master) throws BluetoothStateException {
        if (uuid == null) {
            throw new NullPointerException("uuid is null");
        }
        return null;
    }

    private static void later(Runnable callback) {
        Thread thread = new Thread(callback, "bluetooth-discovery");
        thread.setDaemon(true);
        thread.start();
    }
}
