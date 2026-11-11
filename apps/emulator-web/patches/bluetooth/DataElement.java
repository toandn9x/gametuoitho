/*
 * Browser compatibility patch for FreeJ2ME, GPL-3.0-or-later.
 * JSR-82 DataElement with the public constructors and constants of the specification.
 * The bundled class declared them package-private, so a MIDlet calling
 * new DataElement(int, Object) from its own package failed with IllegalAccessError.
 */
package javax.bluetooth;

import java.util.Enumeration;
import java.util.Vector;

public class DataElement {
    public static final int NULL = 0x0000;
    public static final int U_INT_1 = 0x0008;
    public static final int U_INT_2 = 0x0009;
    public static final int U_INT_4 = 0x000A;
    public static final int U_INT_8 = 0x000B;
    public static final int U_INT_16 = 0x000C;
    public static final int INT_1 = 0x0010;
    public static final int INT_2 = 0x0011;
    public static final int INT_4 = 0x0012;
    public static final int INT_8 = 0x0013;
    public static final int INT_16 = 0x0014;
    public static final int URL = 0x0040;
    public static final int UUID = 0x0018;
    public static final int BOOL = 0x0028;
    public static final int STRING = 0x0020;
    public static final int DATSEQ = 0x0030;
    public static final int DATALT = 0x0038;

    private final int type;
    private long longValue;
    private boolean boolValue;
    private Object objectValue;
    private Vector elements;

    public DataElement(int valueType) {
        if (valueType != NULL && valueType != DATSEQ && valueType != DATALT) {
            throw new IllegalArgumentException("valueType must be NULL, DATSEQ or DATALT");
        }
        this.type = valueType;
        if (valueType != NULL) {
            this.elements = new Vector();
        }
    }

    public DataElement(boolean bool) {
        this.type = BOOL;
        this.boolValue = bool;
    }

    public DataElement(int valueType, long value) {
        switch (valueType) {
            case U_INT_1: case U_INT_2: case U_INT_4:
            case INT_1: case INT_2: case INT_4: case INT_8:
                break;
            default:
                throw new IllegalArgumentException("valueType is not a long integer type");
        }
        this.type = valueType;
        this.longValue = value;
    }

    public DataElement(int valueType, Object value) {
        if (value == null) {
            throw new IllegalArgumentException("value is null");
        }
        switch (valueType) {
            case URL: case STRING:
                if (!(value instanceof String)) throw new IllegalArgumentException("value must be a String");
                break;
            case UUID:
                if (!(value instanceof UUID)) throw new IllegalArgumentException("value must be a UUID");
                break;
            case U_INT_8: case U_INT_16: case INT_16:
                if (!(value instanceof byte[])) throw new IllegalArgumentException("value must be a byte[]");
                break;
            default:
                throw new IllegalArgumentException("valueType does not take an object value");
        }
        this.type = valueType;
        this.objectValue = value;
    }

    private void requireSequence() {
        if (elements == null) {
            throw new ClassCastException("not a DATSEQ or DATALT element");
        }
    }

    public void addElement(DataElement elem) {
        requireSequence();
        if (elem == null) throw new NullPointerException("elem is null");
        elements.addElement(elem);
    }

    public void insertElementAt(DataElement elem, int index) {
        requireSequence();
        if (elem == null) throw new NullPointerException("elem is null");
        elements.insertElementAt(elem, index);
    }

    public int getSize() {
        requireSequence();
        return elements.size();
    }

    public boolean removeElement(DataElement elem) {
        requireSequence();
        if (elem == null) throw new NullPointerException("elem is null");
        return elements.removeElement(elem);
    }

    public int getDataType() {
        return type;
    }

    public long getLong() {
        switch (type) {
            case U_INT_1: case U_INT_2: case U_INT_4:
            case INT_1: case INT_2: case INT_4: case INT_8:
                return longValue;
            default:
                throw new ClassCastException("not a long integer element");
        }
    }

    public boolean getBoolean() {
        if (type != BOOL) throw new ClassCastException("not a BOOL element");
        return boolValue;
    }

    /** byte[] / String / UUID value, or an Enumeration of the elements of a DATSEQ / DATALT. */
    public Object getValue() {
        if (elements != null) {
            return elements.elements();
        }
        if (objectValue == null) {
            throw new ClassCastException("element has no object value");
        }
        if (objectValue instanceof byte[]) {
            return ((byte[]) objectValue).clone();
        }
        return objectValue;
    }

    public String toString() {
        if (elements != null) {
            StringBuffer out = new StringBuffer(type == DATSEQ ? "DATSEQ {" : "DATALT {");
            for (Enumeration e = elements.elements(); e.hasMoreElements();) {
                out.append(' ').append(e.nextElement());
            }
            return out.append(" }").toString();
        }
        if (type == NULL) return "NULL";
        if (type == BOOL) return "BOOL " + boolValue;
        if (objectValue != null) return "0x" + Integer.toHexString(type) + " " + objectValue;
        return "0x" + Integer.toHexString(type) + " " + longValue;
    }
}
