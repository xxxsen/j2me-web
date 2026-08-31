package org.j2me.web;

import java.lang.reflect.Field;

import org.mini.apploader.AppLoader;
import org.mini.apploader.GApplication;
import org.mini.glfw.Glfw;
import org.mini.gui.callback.GCallBack;

public final class WebLauncher {
    private static final String APP_NAME = "freej2meonminijvm.jar";
    private static final String APP_PATH = "/lib/freej2meonminijvm.jar";

    private WebLauncher() {
    }

    public static void main(String[] args) {
        GCallBack callback = GCallBack.getInstance();
        callback.init(960, 540);

        if (!AppLoader.addApp(APP_NAME, APP_PATH)) {
            throw new RuntimeException("Unable to install " + APP_PATH);
        }

        GApplication app = AppLoader.runApp(APP_NAME);
        if (app == null) {
            throw new RuntimeException("Unable to start " + APP_NAME);
        }

        startHostBridge(app);
        Glfw.executeMainLoop();
    }

    private static void startHostBridge(final GApplication app) {
        Thread bridge = new Thread(new Runnable() {
            public void run() {
                try {
                    System.out.println("[j2me-web] HOST_BRIDGE_STARTING");
                    ClassLoader loader = app.getClass().getClassLoader();
                    Class<?> platformClass = Class.forName("org.recompile.mobile.MobilePlatform", true, loader);
                    Field terminated = platformClass.getField("appTerminated");
                    System.out.println("[j2me-web] HOST_BRIDGE_READY");

                    while (true) {
                        if (terminated.getBoolean(null)) {
                            System.out.println("[j2me-web] MIDLET_EXIT_REQUESTED");
                            return;
                        }
                        Thread.sleep(25L);
                    }
                } catch (Throwable error) {
                    System.out.println("[j2me-web] HOST_BRIDGE_FAILED " + error);
                }
            }
        }, "j2me-web-host-bridge");
        bridge.setDaemon(true);
        bridge.start();
    }
}
