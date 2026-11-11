/*
 * Browser compatibility patch for FreeJ2ME, GPL-3.0-or-later.
 * JSR-82 ServiceRegistrationException with public constructors (the bundled ones were package-private).
 */
package javax.bluetooth;

import java.io.IOException;

public class ServiceRegistrationException extends IOException {
    public ServiceRegistrationException() {
        super();
    }

    public ServiceRegistrationException(String msg) {
        super(msg);
    }
}
