package org.j2me.web;

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

        Glfw.executeMainLoop();
    }
}
