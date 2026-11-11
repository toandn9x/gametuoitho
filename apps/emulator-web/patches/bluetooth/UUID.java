/*
 * Browser compatibility patch for FreeJ2ME, GPL-3.0-or-later.
 * JSR-82 UUID (javax.bluetooth). Missing from the bundled emulator: MIDlets that build their
 * Bluetooth service UUID at startup (e.g. Art Of War 2 Bluetooth) stopped with NoClassDefFoundError.
 * Value object only; no Bluetooth hardware is involved.
 */
package javax.bluetooth;

public class UUID {
    // Bluetooth base UUID 00000000-0000-1000-8000-00805F9B34FB; short UUIDs fill the first 32 bits.
    private static final long BASE_LOW = 0x800000805F9B34FBL;
    private static final long BASE_HIGH = 0x0000000000001000L;

    private final long high;
    private final long low;

    public UUID(long uuidValue) {
        if (uuidValue < 0 || uuidValue > 0xFFFFFFFFL) {
            throw new IllegalArgumentException("uuidValue is not in the range [0, 2^32 - 1]");
        }
        this.high = (uuidValue << 32) | BASE_HIGH;
        this.low = BASE_LOW;
    }

    public UUID(String uuidValue, boolean shortUUID) {
        if (uuidValue == null) {
            throw new NullPointerException("uuidValue is null");
        }
        int length = uuidValue.length();
        if (length == 0 || length > (shortUUID ? 8 : 32)) {
            throw new IllegalArgumentException("uuidValue has an invalid length");
        }
        for (int i = 0; i < length; i++) {
            if (Character.digit(uuidValue.charAt(i), 16) < 0) {
                throw new NumberFormatException("uuidValue contains a non-hexadecimal character");
            }
        }
        if (shortUUID) {
            this.high = (Long.parseLong(uuidValue, 16) << 32) | BASE_HIGH;
            this.low = BASE_LOW;
        } else {
            String padded = "00000000000000000000000000000000".substring(length) + uuidValue;
            this.high = Long.parseUnsignedLong(padded.substring(0, 16), 16);
            this.low = Long.parseUnsignedLong(padded.substring(16), 16);
        }
    }

    /** All 32 hex digits, upper case, no dashes (the form common JSR-82 stacks return). */
    public String toString() {
        return hex16(high) + hex16(low);
    }

    private static String hex16(long value) {
        String hex = Long.toHexString(value).toUpperCase();
        return "0000000000000000".substring(hex.length()) + hex;
    }

    public boolean equals(Object value) {
        if (!(value instanceof UUID)) {
            return false;
        }
        UUID other = (UUID) value;
        return high == other.high && low == other.low;
    }

    public int hashCode() {
        return (int) (high ^ (high >>> 32) ^ low ^ (low >>> 32));
    }
}
