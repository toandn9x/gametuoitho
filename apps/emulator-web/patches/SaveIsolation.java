/* Browser save compatibility helper for FreeJ2ME, GPL-3.0-or-later. */
package pl.zb3.freej2me.launcher;

import java.io.File;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.FileAlreadyExistsException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.Paths;
import java.nio.file.StandardCopyOption;
import java.nio.file.StandardOpenOption;
import java.util.Arrays;
import org.recompile.mobile.MIDletLoader;

/** Select a host-supplied identity before FreeJ2ME creates its platform/RMS. */
public final class SaveIsolation {
    private SaveIsolation() {}

    public static String prepare(String jarPath, String id) throws IOException {
        if (id == null || !id.matches("[a-zA-Z0-9_-]+")) {
            throw new IOException("Invalid game save identity");
        }
        String appId = "_gtt_" + id;
        Path target = Paths.get(appId);
        Path source = Paths.get(jarPath);
        Files.createDirectories(target);
        Path ready = target.resolve(".save-ready");
        if (!Files.exists(ready)) {
            // Inspect the manifest only; the MIDlet is not started here.
            try (MIDletLoader loader = MIDletLoader.getMIDletLoader(new File(jarPath))) {
                LauncherUtil.ensureAppId(loader, new File(jarPath).getName());
                Path legacy = Paths.get(loader.getAppId()).toAbsolutePath().normalize();
                Path root = Paths.get("").toAbsolutePath().normalize();
                Path oldJar = legacy.resolve("app.jar");
                if (root.equals(legacy.getParent()) && !legacy.equals(target.toAbsolutePath())
                        && Files.isRegularFile(oldJar)
                        && Arrays.equals(Files.readAllBytes(source), Files.readAllBytes(oldJar))
                        && claim(legacy.resolve(".save-owner"), appId)) {
                    copyMissing(legacy.resolve("rms"), target.resolve("rms"));
                    copyMissing(legacy.resolve("config"), target.resolve("config"));
                }
            }
            // A failed migration stops startup and can be retried without losing the original.
            Files.write(ready, new byte[0]);
        }
        // Run the downloaded version, including when an admin replaces a version's asset.
        Files.copy(source, target.resolve("app.jar"), StandardCopyOption.REPLACE_EXISTING);
        return appId;
    }

    private static boolean claim(Path marker, String appId) throws IOException {
        // CheerpJ's filesystem can overwrite an existing file despite CREATE_NEW.
        if (Files.exists(marker)) {
            return appId.equals(new String(Files.readAllBytes(marker), StandardCharsets.UTF_8));
        }
        try {
            Files.write(marker, appId.getBytes(StandardCharsets.UTF_8), StandardOpenOption.CREATE_NEW);
            return true;
        } catch (FileAlreadyExistsException exists) {
            return appId.equals(new String(Files.readAllBytes(marker), StandardCharsets.UTF_8));
        }
    }

    private static void copyMissing(Path source, Path target) throws IOException {
        if (!Files.exists(source) || Files.isSymbolicLink(source)) return;
        if (Files.isDirectory(source)) {
            Files.createDirectories(target);
            try (java.nio.file.DirectoryStream<Path> entries = Files.newDirectoryStream(source)) {
                for (Path entry : entries) copyMissing(entry, target.resolve(entry.getFileName()));
            }
        } else if (!Files.exists(target)) {
            try {
                Files.copy(source, target);
            } catch (FileAlreadyExistsException exists) {
                // Never overwrite an existing save, including after an interrupted migration.
            }
        }
    }
}
