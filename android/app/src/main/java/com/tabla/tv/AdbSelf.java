package com.tabla.tv;

import java.io.ByteArrayOutputStream;
import java.io.DataInputStream;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.math.BigInteger;
import java.net.InetSocketAddress;
import java.net.Socket;
import java.nio.ByteBuffer;
import java.nio.ByteOrder;
import java.nio.charset.StandardCharsets;
import java.security.KeyFactory;
import java.security.KeyPair;
import java.security.KeyPairGenerator;
import java.security.PrivateKey;
import java.security.PublicKey;
import java.security.interfaces.RSAPublicKey;
import java.security.spec.PKCS8EncodedKeySpec;
import java.security.spec.X509EncodedKeySpec;

import javax.crypto.Cipher;

/**
 * A tiny ADB client that talks to this device's own ADB (127.0.0.1:5555), so Tabla can give itself the
 * settings that otherwise need a computer: "Display over other apps" (auto-start on Fire TV), "Install
 * unknown apps" (self-update), home app, and quiet updates on Fire TV.
 *
 * It only works while "ADB debugging" (Fire TV) / "USB debugging" (Google TV) is on, and the first time
 * the TV asks "Allow USB debugging?"; the owner ticks "Always allow" and presses OK. Tabla's key is kept
 * in its own files, so later connections need no question.
 *
 * Plain Java (no Android classes), so it can be tested on a computer.
 */
final class AdbSelf implements AutoCloseable {
    static final int PORT = 5555;
    private static final int CNXN = 0x4e584e43, AUTH = 0x48545541, OPEN = 0x4e45504f, OKAY = 0x59414b4f,
        CLSE = 0x45534c43, WRTE = 0x45545257;
    private static final int VERSION = 0x01000000, MAX_DATA = 4096;
    private static final int AUTH_TOKEN = 1, AUTH_SIGNATURE = 2, AUTH_RSAPUBLICKEY = 3;
    /** SHA-1 DigestInfo header: ADB signs the 20-byte token as if it were a SHA-1 hash. */
    private static final byte[] SHA1_PREFIX = {0x30, 0x21, 0x30, 0x09, 0x06, 0x05, 0x2b, 0x0e, 0x03, 0x02, 0x1a,
        0x05, 0x00, 0x04, 0x14};

    private final Socket socket;
    private final DataInputStream in;
    private final OutputStream out;
    private int deviceMaxData = MAX_DATA;
    private int nextId = 1;

    /** Thrown when nobody answered the "Allow USB debugging?" question in time (or pressed Cancel). */
    static final class NotAllowed extends IOException {
        NotAllowed() {
            super("not allowed on the TV");
        }
    }

    private AdbSelf(Socket socket) throws IOException {
        this.socket = socket;
        this.in = new DataInputStream(socket.getInputStream());
        this.out = socket.getOutputStream();
    }

    /**
     * Connects and signs in with Tabla's key (made and saved in keyDir the first time).
     * askMs: how long to wait for someone to answer the TV's question; 0 = don't ask, fail instead.
     * Throws java.net.ConnectException when ADB debugging is off.
     */
    static AdbSelf connect(String host, int port, File keyDir, long askMs) throws Exception {
        KeyPair keys = keys(keyDir);
        Socket s = new Socket();
        s.connect(new InetSocketAddress(host, port), 5_000);
        s.setSoTimeout(15_000);
        AdbSelf adb = new AdbSelf(s);
        try {
            adb.signIn(keys, askMs);
            return adb;
        } catch (Exception e) {
            adb.close();
            throw e;
        }
    }

    private void signIn(KeyPair keys, long askMs) throws Exception {
        send(CNXN, VERSION, MAX_DATA, "host::\0".getBytes(StandardCharsets.UTF_8));
        boolean signed = false;
        while (true) {
            Msg m = read();
            if (m.cmd == CNXN) {
                deviceMaxData = Math.max(256, Math.min(m.arg1, 256 * 1024));
                return;
            }
            if (m.cmd != AUTH || m.arg0 != AUTH_TOKEN) continue;
            if (!signed) {
                signed = true;
                send(AUTH, AUTH_SIGNATURE, 0, sign(keys.getPrivate(), m.data));
                continue;
            }
            // The device doesn't know this key yet: offer it, and the TV shows "Allow USB debugging?".
            if (askMs <= 0) throw new NotAllowed();
            byte[] pub = (publicKeyText((RSAPublicKey) keys.getPublic()) + " tabla@tv\0").getBytes(StandardCharsets.UTF_8);
            send(AUTH, AUTH_RSAPUBLICKEY, 0, pub);
            socket.setSoTimeout((int) Math.min(askMs, Integer.MAX_VALUE));
            Msg answer;
            try {
                answer = read();
            } catch (java.net.SocketTimeoutException e) {
                throw new NotAllowed();
            }
            socket.setSoTimeout(15_000);
            if (answer.cmd == CNXN) {
                deviceMaxData = Math.max(256, Math.min(answer.arg1, 256 * 1024));
                return;
            }
            throw new NotAllowed();
        }
    }

    /** Runs a shell command and returns what it printed. */
    String shell(String command) throws IOException {
        return new String(run("shell:" + command, null), StandardCharsets.UTF_8).trim();
    }

    /** Runs a command with raw input and output (no terminal in between), e.g. installing an APK. */
    String exec(String command, InputStream input) throws IOException {
        return new String(run("exec:" + command, input), StandardCharsets.UTF_8).trim();
    }

    private byte[] run(String service, InputStream input) throws IOException {
        int local = nextId++;
        send(OPEN, local, 0, (service + "\0").getBytes(StandardCharsets.UTF_8));
        int remote = 0;
        ByteArrayOutputStream result = new ByteArrayOutputStream();
        // Wait for the device to accept the stream.
        while (remote == 0) {
            Msg m = read();
            if (m.arg1 != local) continue;
            if (m.cmd == OKAY) remote = m.arg0;
            else if (m.cmd == CLSE) throw new IOException("refused: " + service);
        }
        if (input != null) {
            byte[] buf = new byte[deviceMaxData];
            for (int n; (n = readFully(input, buf)) > 0; ) {
                byte[] chunk = n == buf.length ? buf : java.util.Arrays.copyOf(buf, n);
                send(WRTE, local, remote, chunk);
                // One chunk at a time: wait for OKAY, keeping any output that arrives meanwhile.
                while (true) {
                    Msg m = read();
                    if (m.arg1 != local) continue;
                    if (m.cmd == OKAY) break;
                    if (m.cmd == WRTE) {
                        result.write(m.data);
                        send(OKAY, local, remote, new byte[0]);
                    } else if (m.cmd == CLSE) {
                        return result.toByteArray();
                    }
                }
            }
        }
        while (true) {
            Msg m = read();
            if (m.arg1 != local) continue;
            if (m.cmd == WRTE) {
                result.write(m.data);
                send(OKAY, local, remote, new byte[0]);
            } else if (m.cmd == CLSE) {
                send(CLSE, local, remote, new byte[0]);
                return result.toByteArray();
            }
        }
    }

    private static int readFully(InputStream input, byte[] buf) throws IOException {
        int total = 0;
        while (total < buf.length) {
            int n = input.read(buf, total, buf.length - total);
            if (n < 0) break;
            total += n;
        }
        return total;
    }

    @Override
    public void close() {
        try {
            socket.close();
        } catch (IOException ignored) {
        }
    }

    // ---------- messages ----------
    private static final class Msg {
        int cmd, arg0, arg1;
        byte[] data;
    }

    private void send(int cmd, int arg0, int arg1, byte[] data) throws IOException {
        ByteBuffer h = ByteBuffer.allocate(24).order(ByteOrder.LITTLE_ENDIAN);
        int sum = 0;
        for (byte b : data) sum += b & 0xff;
        h.putInt(cmd).putInt(arg0).putInt(arg1).putInt(data.length).putInt(sum).putInt(~cmd);
        out.write(h.array());
        out.write(data);
        out.flush();
    }

    private Msg read() throws IOException {
        byte[] head = new byte[24];
        in.readFully(head);
        ByteBuffer h = ByteBuffer.wrap(head).order(ByteOrder.LITTLE_ENDIAN);
        Msg m = new Msg();
        m.cmd = h.getInt();
        m.arg0 = h.getInt();
        m.arg1 = h.getInt();
        int len = h.getInt();
        h.getInt(); // checksum: TCP already guards the bytes
        if (h.getInt() != ~m.cmd || len < 0 || len > 1024 * 1024) throw new IOException("bad ADB message");
        m.data = new byte[len];
        in.readFully(m.data);
        return m;
    }

    // ---------- keys ----------
    static byte[] sign(PrivateKey key, byte[] token) throws Exception {
        Cipher c = Cipher.getInstance("RSA/ECB/PKCS1Padding");
        c.init(Cipher.ENCRYPT_MODE, key);
        c.update(SHA1_PREFIX);
        return c.doFinal(token);
    }

    /** Tabla's own ADB key, made once and kept (so "Always allow" keeps working). */
    static synchronized KeyPair keys(File dir) throws Exception {
        File priv = new File(dir, "adbkey"), pub = new File(dir, "adbkey.pub.der");
        KeyFactory f = KeyFactory.getInstance("RSA");
        if (priv.exists() && pub.exists()) {
            try {
                return new KeyPair(f.generatePublic(new X509EncodedKeySpec(readAll(pub))),
                    f.generatePrivate(new PKCS8EncodedKeySpec(readAll(priv))));
            } catch (Exception ignored) {
                // Damaged files: make a new key (the TV asks once more).
            }
        }
        KeyPairGenerator g = KeyPairGenerator.getInstance("RSA");
        g.initialize(2048);
        KeyPair k = g.generateKeyPair();
        writeAll(priv, k.getPrivate().getEncoded());
        writeAll(pub, k.getPublic().getEncoded());
        return k;
    }

    /** The public key in ADB's own format (as in ~/.android/adbkey.pub), without the name. */
    static String publicKeyText(RSAPublicKey key) {
        BigInteger r32 = BigInteger.ONE.shiftLeft(32);
        BigInteger n = key.getModulus();
        BigInteger rr = BigInteger.ONE.shiftLeft(4096).mod(n); // (2^2048)^2 mod n
        BigInteger n0inv = n.mod(r32).modInverse(r32).negate().mod(r32);
        ByteBuffer b = ByteBuffer.allocate(4 + 4 + 256 + 256 + 4).order(ByteOrder.LITTLE_ENDIAN);
        b.putInt(64);
        b.putInt(n0inv.intValue());
        for (int i = 0; i < 64; i++) b.putInt(n.shiftRight(32 * i).mod(r32).intValue());
        for (int i = 0; i < 64; i++) b.putInt(rr.shiftRight(32 * i).mod(r32).intValue());
        b.putInt(key.getPublicExponent().intValue());
        return base64(b.array());
    }

    private static String base64(byte[] data) {
        final String abc = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
        StringBuilder s = new StringBuilder();
        for (int i = 0; i < data.length; i += 3) {
            int b0 = data[i] & 0xff;
            int b1 = i + 1 < data.length ? data[i + 1] & 0xff : 0;
            int b2 = i + 2 < data.length ? data[i + 2] & 0xff : 0;
            int v = (b0 << 16) | (b1 << 8) | b2;
            s.append(abc.charAt((v >> 18) & 63)).append(abc.charAt((v >> 12) & 63));
            s.append(i + 1 < data.length ? abc.charAt((v >> 6) & 63) : '=');
            s.append(i + 2 < data.length ? abc.charAt(v & 63) : '=');
        }
        return s.toString();
    }

    private static byte[] readAll(File f) throws IOException {
        try (InputStream in = new FileInputStream(f)) {
            ByteArrayOutputStream out = new ByteArrayOutputStream();
            byte[] buf = new byte[4096];
            for (int n; (n = in.read(buf)) > 0; ) out.write(buf, 0, n);
            return out.toByteArray();
        }
    }

    private static void writeAll(File f, byte[] data) throws IOException {
        try (OutputStream out = new FileOutputStream(f)) {
            out.write(data);
        }
    }
}
