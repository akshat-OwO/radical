import android.graphics.Rect;
import android.view.Gravity;
import android.view.View;
import android.view.ViewGroup;
import android.webkit.WebView;
import android.widget.FrameLayout;
import androidx.core.graphics.Insets;
import androidx.window.layout.DisplayFeature;
import androidx.window.layout.FoldingFeature;
import com.google.android.material.navigation.NavigationBarView;
import com.google.android.material.bottomnavigation.BottomNavigationView;
import com.google.android.material.navigationrail.NavigationRailView;
import com.google.android.material.badge.BadgeDrawable;
import java.util.List;
import org.json.JSONArray;
import org.json.JSONObject;

/** Bars own no WebView. Resizing never detaches the document or its input connection. */
final class RadicalNavigation {
    private static final String[] IDS = { __SECTION_IDS__ };
    private static final String[] TITLES = { __SECTION_TITLES__ };
    private static final int[] ICONS = { __SECTION_ICONS__ };
    private static final int[] SELECTED_ICONS = { __SECTION_SELECTED_ICONS__ };
    private final MainActivity activity;
    private final WebView webView;
    private final FrameLayout overlay;
    private BottomNavigationView bottom;
    private NavigationRailView rail;
    private final int[] origin = new int[2];
    private final Rect clip = new Rect();
    private boolean hidden;
    private int active;
    private int nightMode;
    private JSONObject state;

    RadicalNavigation(MainActivity activity, WebView view) {
        this.activity = activity;
        webView = view;
        overlay = new FrameLayout(view.getContext());
        ((ViewGroup) view.getParent()).addView(overlay, new ViewGroup.LayoutParams(-1, -1));
        build();
    }

    private int night() {
        return activity.getResources().getConfiguration().uiMode & android.content.res.Configuration.UI_MODE_NIGHT_MASK;
    }

    // Material resolves every color once, at construction, and the activity handles
    // uiMode itself. Rebuilding is the only way all channels follow night mode.
    private void build() {
        nightMode = night();
        if (bottom != null) {
            overlay.removeView(bottom);
            overlay.removeView(rail);
        }
        bottom = new BottomNavigationView(activity);
        rail = new NavigationRailView(activity);
        for (NavigationBarView bar : new NavigationBarView[] { bottom, rail }) {
            // Physical placement and safe area are owned here, not Material's inset listener.
            androidx.core.view.ViewCompat.setOnApplyWindowInsetsListener(bar, (v, insets) -> insets);
            for (int index = 0; index < IDS.length; index++) {
                bar.getMenu().add(0, index + 1, index, TITLES[index]).setIcon(index == active ? SELECTED_ICONS[index] : ICONS[index]);
            }
            bar.getMenu().getItem(active).setChecked(true);
            bar.setOnItemSelectedListener(item -> {
                select(item.getItemId() - 1);
                return false;
            });
            bar.setOnItemReselectedListener(item -> select(item.getItemId() - 1));
            __THEME_SETUP__
            overlay.addView(bar, new FrameLayout.LayoutParams(-2, -2));
        }
        rail.setVisibility(View.GONE);
        if (state != null) apply(state);
    }

    private void select(int index) {
        webView.evaluateJavascript("window.dispatchEvent(new CustomEvent('radicalSectionSelect',{detail:{id:"
            + JSONObject.quote(IDS[index]) + "}}));", null);
    }

    void update(JSONObject next) {
        if (!next.has("hidden") || next.optJSONArray("sections") == null) return;
        state = next;
        apply(next);
        activity.refreshWindowContext();
    }

    private void apply(JSONObject state) {
        JSONObject selected = state.optJSONObject("active");
        JSONArray entries = state.optJSONArray("sections");
        hidden = state.optBoolean("hidden");
        int previous = active;
        for (int index = 0; index < IDS.length; index++) {
            if (selected != null && IDS[index].equals(selected.optString("id"))) active = index;
        }
        for (NavigationBarView bar : new NavigationBarView[] { bottom, rail }) {
            for (int index = 0; index < IDS.length; index++) {
                // Menu state updates don't invoke selection listeners.
                bar.getMenu().getItem(index).setChecked(index == active);
                if (active != previous) bar.getMenu().getItem(index).setIcon(index == active ? SELECTED_ICONS[index] : ICONS[index]);
                for (int entry = 0; entry < entries.length(); entry++) {
                    JSONObject value = entries.optJSONObject(entry);
                    if (value == null || !IDS[index].equals(value.optString("id"))) continue;
                    Object badge = value.opt("badge");
                    if (badge == null || badge == JSONObject.NULL) {
                        bar.removeBadge(index + 1);
                    } else {
                        BadgeDrawable drawable = bar.getOrCreateBadge(index + 1);
                        __BADGE_THEME__
                        if (badge instanceof Number) {
                            drawable.clearText();
                            drawable.setNumber(Math.max(0, ((Number) badge).intValue()));
                        } else {
                            drawable.clearNumber();
                            drawable.setText(badge.toString());
                        }
                    }
                }
            }
        }
    }

    Insets layout(Insets system, boolean keyboard, float width, List<DisplayFeature> features) {
        if (night() != nightMode) build();
        int w = webView.getWidth();
        int h = webView.getHeight();
        float density = webView.getResources().getDisplayMetrics().density;
        boolean compact = width < 600;
        int left = system.left;
        int top = system.top;
        int right = w - system.right;
        int bottomEdge = h - (keyboard ? 0 : system.bottom);
        webView.getLocationInWindow(origin);
        for (DisplayFeature feature : features) {
            if (!(feature instanceof FoldingFeature)) continue;
            FoldingFeature fold = (FoldingFeature) feature;
            if (!fold.isSeparating() && fold.getOcclusionType() != FoldingFeature.OcclusionType.FULL) continue;
            Rect hinge = new Rect(fold.getBounds());
            hinge.offset(-origin[0], -origin[1]);
            if (fold.getOrientation() == FoldingFeature.Orientation.VERTICAL) {
                // Keep the entire control in one pane, including a bottom bar in a narrow window.
                right = Math.min(right, hinge.left);
            } else if (compact) {
                top = Math.max(top, hinge.bottom);
            } else {
                bottomEdge = Math.min(bottomEdge, hinge.top);
            }
        }
        boolean show = !hidden && w > 0 && h > 0;
        bottom.setVisibility(show && compact ? View.VISIBLE : View.GONE);
        rail.setVisibility(show && !compact ? View.VISIBLE : View.GONE);
        int barWidth = Math.min(Math.max(0, right - left), Math.round(80 * density));
        int barHeight = Math.min(Math.max(0, bottomEdge - top), Math.round(80 * density));
        // Paint through system bars while keeping all items inside the safe region.
        int bottomPadding = keyboard ? 0 : system.bottom;
        bottom.setPadding(0, 0, 0, bottomPadding);
        int railBottomPadding = bottomEdge == h - bottomPadding ? bottomPadding : 0;
        rail.setPadding(0, top, 0, railBottomPadding);
        place(bottom, left, bottomEdge - barHeight, Math.max(0, right - left), barHeight + bottomPadding);
        place(rail, left, 0, barWidth, Math.max(0, bottomEdge + railBottomPadding));
        int insetLeft = show && !compact ? left + barWidth : system.left;
        int insetBottom = show && compact ? h - bottomEdge + barHeight : keyboard ? 0 : system.bottom;
        // Keep CSS dimensions unchanged. Safe area places HTML inside this clipped rectangle.
        // Only the bottom bar covers the page; elsewhere it paints through the gesture inset.
        int clipBottom = show && compact ? Math.max(0, h - insetBottom) : h;
        if (clip.left != insetLeft || clip.right != w || clip.bottom != clipBottom) {
            clip.set(insetLeft, 0, w, clipBottom);
            webView.setClipBounds(clip);
        }
        return Insets.of(insetLeft, system.top, system.right, insetBottom);
    }

    private void place(View view, int x, int y, int width, int height) {
        int right = Math.max(0, overlay.getWidth() - x - width);
        FrameLayout.LayoutParams current = (FrameLayout.LayoutParams) view.getLayoutParams();
        if (current.leftMargin == x && current.topMargin == y && current.width == width && current.height == height && current.rightMargin == right) return;
        FrameLayout.LayoutParams next = new FrameLayout.LayoutParams(width, height, Gravity.TOP | Gravity.START);
        next.leftMargin = x;
        next.topMargin = y;
        next.rightMargin = right;
        view.setLayoutParams(next);
    }
}
