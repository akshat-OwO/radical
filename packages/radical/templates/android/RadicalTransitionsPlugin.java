import android.animation.Animator;
import android.animation.AnimatorListenerAdapter;
import android.animation.ValueAnimator;
import android.graphics.Bitmap;
import android.os.Handler;
import android.os.Looper;
import android.view.PixelCopy;
import android.view.View;
import android.view.ViewGroup;
import android.view.animation.DecelerateInterpolator;
import android.webkit.WebView;
import android.widget.ImageView;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

@CapacitorPlugin(name = "RadicalTransitions")
public class RadicalTransitionsPlugin extends Plugin {
    private final Handler handler = new Handler(Looper.getMainLooper());
    private ImageView overlay;
    private View movingContent;
    private String overlayId;
    private Runnable expiry;

    public void clearData() { if (overlayId != null) clear(overlayId); }

    private void clear(String id) {
        if (!id.equals(overlayId)) return;
        if (expiry != null) handler.removeCallbacks(expiry);
        expiry = null;
        ImageView old = overlay;
        overlay = null;
        overlayId = null;
        View content = movingContent;
        movingContent = null;
        if (content != null) {
            content.animate().cancel();
            content.setTranslationX(0);
        }
        if (old != null) {
            old.animate().cancel();
            if (old.getParent() instanceof ViewGroup) ((ViewGroup) old.getParent()).removeView(old);
            // RenderThread may still reference this bitmap; let GC reclaim it.
            old.setImageDrawable(null);
        }
    }

    private void resolve(PluginCall call, String id) {
        JSObject result = new JSObject();
        result.put("id", id);
        call.resolve(result);
    }

    @PluginMethod
    public void cover(PluginCall call) {
        getActivity().runOnUiThread(() -> {
            String id = call.getString("id");
            if (id == null) { call.reject("Missing id"); return; }
            if (overlayId != null) clear(overlayId);
            ViewGroup root = (ViewGroup) getActivity().getWindow().getDecorView();
            if (root.getWidth() == 0 || root.getHeight() == 0) { call.reject("No visible window"); return; }
            if (android.os.Build.VERSION.SDK_INT < 26) { call.reject("Window capture requires API 26"); return; }
            overlayId = id;
            // Bound pending copies too. A late callback may never attach a stale image.
            expiry = () -> clear(id);
            handler.postDelayed(expiry, 3000);
            try {
                Bitmap captured = Bitmap.createBitmap(root.getWidth(), root.getHeight(), Bitmap.Config.ARGB_8888);
                PixelCopy.request(getActivity().getWindow(), captured, result -> {
                    if (!id.equals(overlayId)) { call.reject("Snapshot cancelled"); return; }
                    if (result != PixelCopy.SUCCESS) {
                        clear(id);
                        call.reject("Window capture failed: " + result);
                        return;
                    }
                    overlay = new ImageView(getContext());
                    overlay.setImageBitmap(captured);
                    overlay.setScaleType(ImageView.ScaleType.FIT_XY);
                    root.addView(overlay, new ViewGroup.LayoutParams(root.getWidth(), root.getHeight()));
                    // PixelCopy completed and attachment precedes the JS commit.
                    resolve(call, id);
                }, handler);
            } catch (RuntimeException | OutOfMemoryError error) {
                clear(id);
                call.reject("Cannot snapshot window", error instanceof Exception ? (Exception) error : null);
            }
        });
    }

    @PluginMethod
    public void reveal(PluginCall call) {
        getActivity().runOnUiThread(() -> {
            String id = call.getString("id");
            if (id == null) { call.reject("Missing id"); return; }
            if (!id.equals(overlayId)) { resolve(call, id); return; }
            // Chromium guarantees the next draw contains all prior DOM updates.
            getBridge().getWebView().postVisualStateCallback(0, new WebView.VisualStateCallback() {
                @Override public void onComplete(long requestId) {
                    if (!id.equals(overlayId)) { resolve(call, id); return; }
                    ImageView captured = overlay;
                    boolean reduced = (android.os.Build.VERSION.SDK_INT >= 26 && !ValueAnimator.areAnimatorsEnabled()) || Boolean.TRUE.equals(call.getBoolean("reducedMotion", false));
                    if (reduced) { clear(id); resolve(call, id); return; }
                    if ("slide".equals(call.getString("kind"))) {
                        ViewGroup root = (ViewGroup) captured.getParent();
                        // Move the whole WebView branch, including its full-window background.
                        View content = getBridge().getWebView();
                        while (content.getParent() instanceof View && content.getParent() != root) content = (View) content.getParent();
                        if (content.getParent() != root) { clear(id); call.reject("No common transition parent"); return; }
                        movingContent = content;
                        float width = root.getWidth();
                        boolean back = "back".equals(call.getString("direction"));
                        // Reordering and initial translation happen in one UI callback, before drawing.
                        content.setTranslationX(back ? -0.3f * width : width);
                        if (!back) {
                            ViewGroup.LayoutParams layout = captured.getLayoutParams();
                            root.removeView(captured);
                            root.addView(captured, root.indexOfChild(content), layout);
                        }
                        content.animate().translationX(0).setDuration(250).setInterpolator(new DecelerateInterpolator()).start();
                        captured.animate().translationX(back ? width : -0.3f * width);
                    } else { captured.animate().alpha(0); }
                    captured.animate().setDuration(250).setInterpolator(new DecelerateInterpolator()).setListener(new AnimatorListenerAdapter() {
                        @Override public void onAnimationEnd(Animator animation) {
                            clear(id);
                            resolve(call, id);
                        }
                    }).start();
                }
            });
        });
    }

    @PluginMethod
    public void remove(PluginCall call) {
        getActivity().runOnUiThread(() -> {
            String id = call.getString("id");
            if (id == null) { call.reject("Missing id"); return; }
            clear(id);
            resolve(call, id);
        });
    }

    @PluginMethod
    public void setBack(PluginCall call) {
        Boolean handles = call.getBoolean("handles");
        if (handles == null) { call.reject("Missing handles"); return; }
        getActivity().runOnUiThread(() -> {
            ((MainActivity) getActivity()).setBackHandled(handles);
            call.resolve();
        });
    }

    @PluginMethod
    public void exit(PluginCall call) {
        getActivity().runOnUiThread(() -> {
            ((MainActivity) getActivity()).exitBack();
            call.resolve();
        });
    }

    // Android pops without an interactive overlay.
    @PluginMethod
    public void settle(PluginCall call) { call.resolve(); }

    @Override protected void handleOnDestroy() {
        if (overlayId != null) clear(overlayId);
    }
}
