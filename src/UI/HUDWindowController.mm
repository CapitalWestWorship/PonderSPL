#import "HUDWindowController.h"
#import "AppDelegate.h"

@implementation HUDWindowController

- (instancetype)initWithSPLEngine:(SPLEngine *)engine csvLogger:(CSVLogger *)logger {
    NSRect frame = NSMakeRect(200, 200, 600, 320);
    NSString *savedHUDFrame = [[NSUserDefaults standardUserDefaults] stringForKey:@"Ponder_HUDWindowFrame"];
    if (savedHUDFrame) {
        NSRect r = NSRectFromString(savedHUDFrame);
        if (r.size.width >= 340 && r.size.height >= 200) {
            BOOL isVisibleOnScreen = NO;
            for (NSScreen *screen in [NSScreen screens]) {
                if (NSIntersectsRect(screen.visibleFrame, r)) {
                    isVisibleOnScreen = YES;
                    break;
                }
            }
            if (isVisibleOnScreen) {
                frame = r;
            }
        }
    }
    NSWindow *window = [[NSWindow alloc] initWithContentRect:frame
                                                   styleMask:(NSWindowStyleMaskTitled |
                                                              NSWindowStyleMaskClosable |
                                                              NSWindowStyleMaskMiniaturizable |
                                                              NSWindowStyleMaskResizable)
                                                     backing:NSBackingStoreBuffered
                                                       defer:NO];
    window.title = @"Ponder SPL — Breakout HUD";
    window.backgroundColor = [NSColor colorWithCalibratedRed:0.07 green:0.08 blue:0.11 alpha:1.0];
    window.minSize = NSMakeSize(340, 200);
    [window setReleasedWhenClosed:NO];

    self = [super initWithWindow:window];
    if (self) {
        window.delegate = self;
        splEngine = engine;
        csvLogger = logger;

        NSUserDefaults *defaults = [NSUserDefaults standardUserDefaults];
        isAlwaysOnTop = [defaults boolForKey:@"Pondera_HUDAlwaysOnTop"];
        if (isAlwaysOnTop) {
            [window setLevel:NSFloatingWindowLevel];
        } else {
            [window setLevel:NSNormalWindowLevel];
        }

        [self setupWebView];
    }
    return self;
}

- (void)showHUD {
    [self showWindow:nil];
    if (isAlwaysOnTop) {
        [self.window setLevel:NSFloatingWindowLevel];
    } else {
        [self.window setLevel:NSNormalWindowLevel];
    }
    [self.window makeKeyAndOrderFront:nil];
    [[NSUserDefaults standardUserDefaults] setBool:YES forKey:@"Ponder_HUDIsOpen"];
    [self saveWindowState];
}

- (void)saveWindowState {
    if (self.window) {
        [[NSUserDefaults standardUserDefaults] setObject:NSStringFromRect(self.window.frame) forKey:@"Ponder_HUDWindowFrame"];
        [[NSUserDefaults standardUserDefaults] synchronize];
    }
}

- (void)windowDidResize:(NSNotification *)notification {
    [self saveWindowState];
}

- (void)windowDidMove:(NSNotification *)notification {
    [self saveWindowState];
}

- (void)windowWillClose:(NSNotification *)notification {
    if (![AppDelegate sharedDelegate].isTerminating) {
        [[NSUserDefaults standardUserDefaults] setBool:NO forKey:@"Ponder_HUDIsOpen"];
        [[NSUserDefaults standardUserDefaults] synchronize];
    }
    [self saveWindowState];
}

- (void)dealloc {
    [updateTimer invalidate];
    updateTimer = nil;
}

- (void)setupWebView {
    WKWebViewConfiguration *config = [[WKWebViewConfiguration alloc] init];
    WKUserContentController *userContent = [[WKUserContentController alloc] init];
    [userContent addScriptMessageHandler:self name:@"ponderaHUD"];
    config.userContentController = userContent;
    [config.preferences setValue:@YES forKey:@"developerExtrasEnabled"];

    webView = [[WKWebView alloc] initWithFrame:self.window.contentView.bounds configuration:config];
    webView.autoresizingMask = NSViewWidthSizable | NSViewHeightSizable;
    webView.navigationDelegate = self;
    [webView setValue:@NO forKey:@"drawsBackground"];

    [self.window.contentView addSubview:webView];

    NSURL *uiURL = [[NSBundle mainBundle] URLForResource:@"hud" withExtension:@"html" subdirectory:@"ui"];
    if (!uiURL) {
        NSString *execDir = [[NSBundle mainBundle] bundlePath];
        NSString *candidate1 = [execDir stringByAppendingPathComponent:@"Contents/Resources/ui/hud.html"];
        NSString *candidate2 = [execDir stringByAppendingPathComponent:@"ui/hud.html"];
        NSString *candidate3 = [execDir stringByAppendingPathComponent:@"../ui/hud.html"];

        NSFileManager *fm = [NSFileManager defaultManager];
        if ([fm fileExistsAtPath:candidate1]) uiURL = [NSURL fileURLWithPath:candidate1];
        else if ([fm fileExistsAtPath:candidate2]) uiURL = [NSURL fileURLWithPath:candidate2];
        else if ([fm fileExistsAtPath:candidate3]) uiURL = [NSURL fileURLWithPath:candidate3];
    }

    if (uiURL) {
        [webView loadFileURL:uiURL allowingReadAccessToURL:[uiURL URLByDeletingLastPathComponent]];
    }

    updateTimer = [NSTimer scheduledTimerWithTimeInterval:1.0 / 30.0
                                                   target:self
                                                 selector:@selector(sendMetricsToWeb)
                                                 userInfo:nil
                                                  repeats:YES];
}

- (void)toggleAlwaysOnTop:(BOOL)floating {
    isAlwaysOnTop = floating;
    if (isAlwaysOnTop) {
        [self.window setLevel:NSFloatingWindowLevel];
    } else {
        [self.window setLevel:NSNormalWindowLevel];
    }
    [[NSUserDefaults standardUserDefaults] setBool:isAlwaysOnTop forKey:@"Pondera_HUDAlwaysOnTop"];
}

- (BOOL)getAlwaysOnTop {
    return isAlwaysOnTop;
}

- (void)userContentController:(WKUserContentController *)userContentController didReceiveScriptMessage:(WKScriptMessage *)message {
    if (![message.body isKindOfClass:[NSDictionary class]]) return;
    NSDictionary *data = (NSDictionary *)message.body;
    NSString *action = data[@"action"];

    if ([action isEqualToString:@"getHUDState"]) {
        [self sendInitialHUDState];
    } else if ([action isEqualToString:@"toggleAlwaysOnTop"]) {
        BOOL val = [data[@"floating"] boolValue];
        [self toggleAlwaysOnTop:val];
    } else if ([action isEqualToString:@"saveHUDTiles"]) {
        NSArray *tiles = data[@"tiles"];
        if (tiles) {
            [[NSUserDefaults standardUserDefaults] setObject:tiles forKey:@"Pondera_HUDTiles"];
        }
    }
}

- (void)sendInitialHUDState {
    NSUserDefaults *defaults = [NSUserDefaults standardUserDefaults];
    NSArray *savedTiles = [defaults arrayForKey:@"Pondera_HUDTiles"];
    NSDictionary *savedThresh = [defaults dictionaryForKey:@"Pondera_Thresholds"];

    NSDictionary *state = @{
        @"alwaysOnTop": @(isAlwaysOnTop),
        @"tiles": savedTiles ? savedTiles : @[],
        @"thresholds": savedThresh ? savedThresh : [NSNull null]
    };

    NSData *jsonData = [NSJSONSerialization dataWithJSONObject:state options:0 error:nil];
    if (jsonData) {
        NSString *jsonStr = [[NSString alloc] initWithData:jsonData encoding:NSUTF8StringEncoding];
        [webView evaluateJavaScript:[NSString stringWithFormat:@"window.onInitialHUDState(%@)", jsonStr] completionHandler:nil];
    }
}

- (void)sendMetricsToWeb {
    if (!splEngine) return;

    SPLMetrics m = splEngine->getMetrics();
    LogStatus logStatus = csvLogger ? [csvLogger getStatus] : LogStatus();

    NSDictionary *payload = @{
        @"LAF": @(round(m.LAF * 10.0) / 10.0),
        @"LAS": @(round(m.LAS * 10.0) / 10.0),
        @"LAmax": @(round(m.LAmax * 10.0) / 10.0),
        @"LAmin": @(round(m.LAmin * 10.0) / 10.0),

        @"LCF": @(round(m.LCF * 10.0) / 10.0),
        @"LCS": @(round(m.LCS * 10.0) / 10.0),
        @"LCmax": @(round(m.LCmax * 10.0) / 10.0),
        @"LCpeak": @(round(m.LCpeak * 10.0) / 10.0),

        @"LZF": @(round(m.LZF * 10.0) / 10.0),
        @"LZS": @(round(m.LZS * 10.0) / 10.0),
        @"LZmax": @(round(m.LZmax * 10.0) / 10.0),
        @"LZpeak": @(round(m.LZpeak * 10.0) / 10.0),

        @"CminusA": @(round(m.CminusA * 10.0) / 10.0),
        @"CminusA_Fast": @(round(m.CminusA_Fast * 10.0) / 10.0),
        @"CminusA_10s": @(round(m.CminusA_10s * 10.0) / 10.0),
        @"CminusA_1m": @(round(m.CminusA_1m * 10.0) / 10.0),
        @"CminusA_5m": @(round(m.CminusA_5m * 10.0) / 10.0),
        @"CminusA_15m": @(round(m.CminusA_15m * 10.0) / 10.0),

        @"LAeq_1s": @(round(m.LAeq_1s * 10.0) / 10.0),
        @"LAeq_5s": @(round(m.LAeq_5s * 10.0) / 10.0),
        @"LAeq_10s": @(round(m.LAeq_10s * 10.0) / 10.0),
        @"LAeq_30s": @(round(m.LAeq_30s * 10.0) / 10.0),
        @"LAeq_1m": @(round(m.LAeq_1m * 10.0) / 10.0),
        @"LAeq_5m": @(round(m.LAeq_5m * 10.0) / 10.0),
        @"LAeq_10m": @(round(m.LAeq_10m * 10.0) / 10.0),
        @"LAeq_15m": @(round(m.LAeq_15m * 10.0) / 10.0),
        @"LAeq_total": @(round(m.LAeq_total * 10.0) / 10.0),

        @"LCeq_1s": @(round(m.LCeq_1s * 10.0) / 10.0),
        @"LCeq_5s": @(round(m.LCeq_5s * 10.0) / 10.0),
        @"LCeq_10s": @(round(m.LCeq_10s * 10.0) / 10.0),
        @"LCeq_30s": @(round(m.LCeq_30s * 10.0) / 10.0),
        @"LCeq_1m": @(round(m.LCeq_1m * 10.0) / 10.0),
        @"LCeq_5m": @(round(m.LCeq_5m * 10.0) / 10.0),
        @"LCeq_10m": @(round(m.LCeq_10m * 10.0) / 10.0),
        @"LCeq_15m": @(round(m.LCeq_15m * 10.0) / 10.0),
        @"LCeq_total": @(round(m.LCeq_total * 10.0) / 10.0),

        @"LZeq_1s": @(round(m.LZeq_1s * 10.0) / 10.0),
        @"LZeq_5s": @(round(m.LZeq_5s * 10.0) / 10.0),
        @"LZeq_10s": @(round(m.LZeq_10s * 10.0) / 10.0),
        @"LZeq_30s": @(round(m.LZeq_30s * 10.0) / 10.0),
        @"LZeq_1m": @(round(m.LZeq_1m * 10.0) / 10.0),
        @"LZeq_5m": @(round(m.LZeq_5m * 10.0) / 10.0),
        @"LZeq_10m": @(round(m.LZeq_10m * 10.0) / 10.0),
        @"LZeq_15m": @(round(m.LZeq_15m * 10.0) / 10.0),
        @"LZeq_total": @(round(m.LZeq_total * 10.0) / 10.0),

        @"offset": @(round(m.offset_dB * 10.0) / 10.0),
        @"isLogging": @(logStatus.isLogging),
        @"isPaused": @(logStatus.isPaused),
        @"logRecords": @(logStatus.recordCount),
        @"logElapsed": @(round(logStatus.elapsedSeconds))
    };

    NSData *jsonData = [NSJSONSerialization dataWithJSONObject:payload options:0 error:nil];
    if (jsonData) {
        NSString *jsonStr = [[NSString alloc] initWithData:jsonData encoding:NSUTF8StringEncoding];
        [webView evaluateJavaScript:[NSString stringWithFormat:@"window.onHUDMetrics(%@)", jsonStr] completionHandler:nil];
    }
}

- (void)webView:(WKWebView *)webView didFinishNavigation:(WKNavigation *)navigation {
    [self sendInitialHUDState];
}

@end
