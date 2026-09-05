package org.j2me.test;

import javax.microedition.midlet.MIDlet;
import javax.microedition.lcdui.Canvas;
import javax.microedition.lcdui.Display;
import javax.microedition.lcdui.Graphics;
import javax.microedition.rms.RecordStore;

/** Self-authored browser regression fixture, compiled locally, never shipped. */
public final class LifecycleMidlet extends MIDlet implements Runnable {
    private volatile boolean running;
    private int ticks;
    private final Canvas canvas = new Canvas() {
        protected void paint(Graphics graphics) {
            graphics.setColor((ticks * 7919) & 0xffffff);
            graphics.fillRect(0, 0, getWidth(), getHeight());
            graphics.setColor(0xffffff);
            graphics.drawString("Tick " + ticks, 4, 4, Graphics.TOP | Graphics.LEFT);
        }
        public void keyPressed(int key) {
            System.out.println("LIFECYCLE_KEY " + key);
        }
    };

    protected void startApp() {
        Display.getDisplay(this).setCurrent(canvas);
        if (!running) {
            running = true;
            new Thread(this).start();
        }
    }

    protected void pauseApp() {}
    protected void destroyApp(boolean unconditional) { running = false; }

    public void run() {
        try {
            RecordStore store = RecordStore.openRecordStore("lifecycle", true);
            if (store.getNumRecords() == 0) store.addRecord(new byte[] { 0 }, 0, 1);
            ticks = store.getRecord(1)[0] & 255;
            System.out.println("LIFECYCLE_RESTORED " + ticks);
            while (running) {
                ticks++;
                store.setRecord(1, new byte[] { (byte) ticks }, 0, 1);
                System.out.println("LIFECYCLE_TICK " + ticks);
                canvas.repaint();
                Thread.sleep(100L);
            }
            store.closeRecordStore();
        } catch (Exception error) { System.out.println("LIFECYCLE_FAILED " + error); }
    }
}
