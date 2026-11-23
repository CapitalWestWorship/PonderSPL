#import "MainWindowController.h"
#import "AppDelegate.h"

@implementation MainWindowController

- (instancetype)init {
    NSRect frame = NSMakeRect(100, 100, 1160, 820);
    NSString *savedMainFrame = [[NSUserDefaults standardUserDefaults] stringForKey:@"Ponder_MainWindowFrame"];
    BOOL hasSavedFrame = NO;
    if (savedMainFrame) {
        NSRect r = NSRectFromString(savedMainFrame);
        if (r.size.width >= 980 && r.size.height >= 680) {
            BOOL isVisibleOnScreen = NO;
            for (NSScreen *screen in [NSScreen screens]) {
                if (NSIntersectsRect(screen.visibleFrame, r)) {
                    isVisibleOnScreen = YES;
                    break;
                }
            }
            if (isVisibleOnScreen) {
                frame = r;
                hasSavedFrame = YES;
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
    window.title = @"Ponder SPL — Acoustic Sound Pressure Level Analyzer";
    window.titleVisibility = NSWindowTitleVisible;
    window.titlebarAppearsTransparent = YES;
    window.backgroundColor = [NSColor colorWithCalibratedRed:0.07 green:0.08 blue:0.11 alpha:1.0];
    window.minSize = NSMakeSize(980, 680);
    [window setReleasedWhenClosed:NO];
    if (!hasSavedFrame) {
        [window center];
    }

    self = [super initWithWindow:window];
    if (self) {
        window.delegate = self;
        splEngine = new SPLEngine();

        NSUserDefaults *defaults = [NSUserDefaults standardUserDefaults];
        double savedOffset = [defaults doubleForKey:@"Pondera_CalibrationOffset"];
        if (savedOffset == 0.0 && ![defaults objectForKey:@"Pondera_CalibrationOffset"]) {
            savedOffset = 100.0;
        }
        splEngine->setCalibrationOffset(savedOffset);

        audioManager = [[AudioDeviceManager alloc] initWithSPLEngine:splEngine];
        csvLogger = [[CSVLogger alloc] initWithSPLEngine:splEngine];
        scheduleManager = [[ScheduleManager alloc] initWithCSVLogger:csvLogger];
        hudController = [[HUDWindowController alloc] initWithSPLEngine:splEngine csvLogger:csvLogger];

        [self setupWebView];
        [self requestMicAccessAndStartAudio];
    }
    return self;
}

- (void)restoreInterfaceState {
    NSUserDefaults *defaults = [NSUserDefaults standardUserDefaults];
    BOOL hudWasOpen = [defaults boolForKey:@"Ponder_HUDIsOpen"];
    if (hudWasOpen && hudController) {
        dispatch_async(dispatch_get_main_queue(), ^{
            [self->hudController showHUD];
        });
    }
}

- (BOOL)windowShouldClose:(NSWindow *)sender {
    [AppDelegate sharedDelegate].isTerminating = YES;
    [self saveWindowState];
    [NSApp terminate:nil];
    return YES;
}

- (void)saveWindowState {
    if (self.window) {
        [[NSUserDefaults standardUserDefaults] setObject:NSStringFromRect(self.window.frame) forKey:@"Ponder_MainWindowFrame"];
    }
    if (hudController) {
        [hudController saveWindowState];
    }
    [[NSUserDefaults standardUserDefaults] synchronize];
}

- (void)windowDidResize:(NSNotification *)notification {
    [self saveWindowState];
}

- (void)windowDidMove:(NSNotification *)notification {
    [self saveWindowState];
}

- (void)windowWillClose:(NSNotification *)notification {
    [self saveWindowState];
}

- (void)dealloc {
    [updateTimer invalidate];
    updateTimer = nil;
    [audioManager stop];
    [csvLogger stopLogging];
    if (splEngine) {
        delete splEngine;
        splEngine = nullptr;
    }
}

- (void)setupWebView {
    WKWebViewConfiguration *config = [[WKWebViewConfiguration alloc] init];
    WKUserContentController *userContent = [[WKUserContentController alloc] init];
    [userContent addScriptMessageHandler:self name:@"pondera"];
    config.userContentController = userContent;
    [config.preferences setValue:@YES forKey:@"developerExtrasEnabled"];

    webView = [[WKWebView alloc] initWithFrame:self.window.contentView.bounds configuration:config];
    webView.autoresizingMask = NSViewWidthSizable | NSViewHeightSizable;
    webView.navigationDelegate = self;
    [webView setValue:@NO forKey:@"drawsBackground"];

    [self.window.contentView addSubview:webView];

    NSURL *uiURL = [[NSBundle mainBundle] URLForResource:@"index" withExtension:@"html" subdirectory:@"ui"];
    if (!uiURL) {
        NSString *execDir = [[NSBundle mainBundle] bundlePath];
        NSString *candidate1 = [execDir stringByAppendingPathComponent:@"Contents/Resources/ui/index.html"];
        NSString *candidate2 = [execDir stringByAppendingPathComponent:@"ui/index.html"];
        NSString *candidate3 = [execDir stringByAppendingPathComponent:@"../ui/index.html"];

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

- (void)requestMicAccessAndStartAudio {
    if (@available(macOS 10.14, *)) {
        AVAuthorizationStatus status = [AVCaptureDevice authorizationStatusForMediaType:AVMediaTypeAudio];
        if (status == AVAuthorizationStatusAuthorized) {
            [self startDefaultAudio];
        } else if (status == AVAuthorizationStatusNotDetermined) {
            [AVCaptureDevice requestAccessForMediaType:AVMediaTypeAudio completionHandler:^(BOOL granted) {
                dispatch_async(dispatch_get_main_queue(), ^{
                    if (granted) [self startDefaultAudio];
                });
            }];
        } else {
            [self startDefaultAudio];
        }
    } else {
        [self startDefaultAudio];
    }
}

- (void)startDefaultAudio {
    NSUserDefaults *defaults = [NSUserDefaults standardUserDefaults];
    NSString *savedUID = [defaults stringForKey:@"Pondera_SelectedDeviceUID"];
    int savedChannel = (int)[defaults integerForKey:@"Pondera_SelectedChannel"];

    std::string uid = savedUID ? [savedUID UTF8String] : "";
    [audioManager startWithDeviceUID:uid channel:savedChannel];
}

- (void)userContentController:(WKUserContentController *)userContentController didReceiveScriptMessage:(WKScriptMessage *)message {
    if (![message.body isKindOfClass:[NSDictionary class]]) return;
    NSDictionary *data = (NSDictionary *)message.body;
    NSString *action = data[@"action"];

    if ([action isEqualToString:@"getInitialState"]) {
        [self sendInitialState];
    } else if ([action isEqualToString:@"openHUD"]) {
        [hudController showHUD];
    } else if ([action isEqualToString:@"setDevice"]) {
        NSString *uid = data[@"deviceUID"];
        int ch = [data[@"channel"] intValue];
        [audioManager startWithDeviceUID:[uid UTF8String] channel:ch];
        [[NSUserDefaults standardUserDefaults] setObject:uid forKey:@"Pondera_SelectedDeviceUID"];
        [[NSUserDefaults standardUserDefaults] setInteger:ch forKey:@"Pondera_SelectedChannel"];
        [self sendInitialState];
    } else if ([action isEqualToString:@"setChannel"]) {
        int ch = [data[@"channel"] intValue];
        splEngine->setChannel(ch);
        [[NSUserDefaults standardUserDefaults] setInteger:ch forKey:@"Pondera_SelectedChannel"];
    } else if ([action isEqualToString:@"setOffset"]) {
        double offset = [data[@"offset"] doubleValue];
        splEngine->setCalibrationOffset(offset);
        [[NSUserDefaults standardUserDefaults] setDouble:offset forKey:@"Pondera_CalibrationOffset"];
    } else if ([action isEqualToString:@"calibrateToTarget"]) {
        double target = [data[@"target"] doubleValue];
        splEngine->calibrateToTarget(target);
        double newOffset = splEngine->getCalibrationOffset();
        [[NSUserDefaults standardUserDefaults] setDouble:newOffset forKey:@"Pondera_CalibrationOffset"];
    } else if ([action isEqualToString:@"chooseCalFile"]) {
        [self openCalFileDialog];
    } else if ([action isEqualToString:@"clearCalFile"]) {
        splEngine->clearCalibrationFile();
        [self sendInitialState];
    } else if ([action isEqualToString:@"setCalEnabled"]) {
        BOOL enabled = [data[@"enabled"] boolValue];
        splEngine->setCalibrationEnabled(enabled);
    } else if ([action isEqualToString:@"resetStats"]) {
        splEngine->resetStats();
    } else if ([action isEqualToString:@"startLogging"]) {
        int interval = [data[@"intervalMs"] intValue];
        NSString *dir = data[@"directory"];
        NSString *format = data[@"format"] ? data[@"format"] : @"txt";
        NSString *event = data[@"eventName"] ? data[@"eventName"] : @"Manual";
        BOOL preventSleep = [data[@"preventSleep"] boolValue];
        std::string dirStr = dir ? [dir UTF8String] : "";
        [csvLogger startLoggingWithDirectory:dirStr
                                  intervalMs:interval
                                      format:[format UTF8String]
                                   eventName:[event UTF8String]
                                preventSleep:preventSleep];
    } else if ([action isEqualToString:@"pauseLogging"]) {
        [csvLogger pauseLogging];
    } else if ([action isEqualToString:@"resumeLogging"]) {
        [csvLogger resumeLogging];
    } else if ([action isEqualToString:@"stopLogging"]) {
        [csvLogger stopLogging];
    } else if ([action isEqualToString:@"chooseLogFolder"]) {
        [self openLogFolderDialog];
    } else if ([action isEqualToString:@"revealLogFile"]) {
        [csvLogger revealInFinder];
    } else if ([action isEqualToString:@"saveThresholds"]) {
        NSDictionary *thresh = data[@"thresholds"];
        if (thresh) {
            [[NSUserDefaults standardUserDefaults] setObject:thresh forKey:@"Pondera_Thresholds"];
        }
    } else if ([action isEqualToString:@"saveSchedules"]) {
        NSArray *schedules = data[@"schedules"];
        if (schedules) {
            [scheduleManager saveEventsFromArray:schedules];
        }
    } else if ([action isEqualToString:@"toggleSchedule"]) {
        NSString *evId = data[@"id"];
        BOOL en = [data[@"enabled"] boolValue];
        [scheduleManager toggleEvent:evId enabled:en];
    }
}

- (void)openCalFileDialog {
    NSOpenPanel *panel = [NSOpenPanel openPanel];
    panel.title = @"Select Microphone Calibration File";
#pragma clang diagnostic push
#pragma clang diagnostic ignored "-Wdeprecated-declarations"
    panel.allowedFileTypes = @[@"cal", @"txt", @"csv", @"dat"];
#pragma clang diagnostic pop
    panel.allowsMultipleSelection = NO;

    [panel beginWithCompletionHandler:^(NSModalResponse result) {
        if (result == NSModalResponseOK && panel.URL) {
            std::string path = [panel.URL.path UTF8String];
            self->splEngine->loadCalibrationFile(path);
            [self sendInitialState];
        }
    }];
}

- (void)openLogFolderDialog {
    NSOpenPanel *panel = [NSOpenPanel openPanel];
    panel.title = @"Select Log Destination Folder";
    panel.canChooseFiles = NO;
    panel.canChooseDirectories = YES;
    panel.canCreateDirectories = YES;
    panel.allowsMultipleSelection = NO;

    [panel beginWithCompletionHandler:^(NSModalResponse result) {
        if (result == NSModalResponseOK && panel.URL) {
            NSString *chosenDir = panel.URL.path;
            [self callJS:[NSString stringWithFormat:@"window.onLogFolderSelected('%@')", chosenDir]];
        }
    }];
}

- (void)sendInitialState {
    auto devices = [audioManager getAvailableInputDevices];
    NSMutableArray *devList = [NSMutableArray array];
    for (const auto& d : devices) {
        [devList addObject:@{
            @"uid": [NSString stringWithUTF8String:d.uid.c_str()],
            @"name": [NSString stringWithUTF8String:d.name.c_str()],
            @"channels": @(d.inputChannels),
            @"sampleRate": @(d.sampleRate),
            @"isDefault": @(d.isDefault)
        }];
    }

    const MicCalibration& cal = splEngine->getMicCalibration();
    NSMutableArray *calPoints = [NSMutableArray array];
    for (const auto& pt : cal.points) {
        [calPoints addObject:@{ @"freq": @(pt.freq), @"db": @(pt.db) }];
    }

    NSDictionary *savedThresh = [[NSUserDefaults standardUserDefaults] dictionaryForKey:@"Pondera_Thresholds"];
    NSArray *schedules = [scheduleManager getEventsAsArray];

    NSDictionary *state = @{
        @"devices": devList,
        @"currentDeviceUID": [NSString stringWithUTF8String:[audioManager getCurrentDeviceUID].c_str()],
        @"currentChannel": @([audioManager getCurrentChannel]),
        @"sampleRate": @([audioManager getCurrentSampleRate]),
        @"offset": @(splEngine->getCalibrationOffset()),
        @"isCalLoaded": @(cal.isLoaded),
        @"isCalEnabled": @(cal.isEnabled),
        @"calFileName": [NSString stringWithUTF8String:cal.filename.c_str()],
        @"calSensFactor": @(cal.sensFactor),
        @"calHasSens": @(cal.hasSensFactor),
        @"calPoints": calPoints,
        @"defaultLogDir": [NSString stringWithUTF8String:[csvLogger getDefaultLogDirectory].c_str()],
        @"thresholds": savedThresh ? savedThresh : [NSNull null],
        @"schedules": schedules ? schedules : @[]
    };

    NSData *jsonData = [NSJSONSerialization dataWithJSONObject:state options:0 error:nil];
    if (jsonData) {
        NSString *jsonStr = [[NSString alloc] initWithData:jsonData encoding:NSUTF8StringEncoding];
        [self callJS:[NSString stringWithFormat:@"window.onInitialState(%@)", jsonStr]];
    }
}

- (void)sendMetricsToWeb {
    if (!splEngine) return;

    SPLMetrics m = splEngine->getMetrics();
    LogStatus logStatus = csvLogger ? [csvLogger getStatus] : LogStatus();

    NSMutableArray *rtaArray = [NSMutableArray arrayWithCapacity:31];
    for (int i = 0; i < 31; ++i) {
        [rtaArray addObject:@(round(m.rta[i] * 10.0) / 10.0)];
    }

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

        // Multi-Window Leqs
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
        @"logElapsed": @(round(logStatus.elapsedSeconds)),
        @"logFormat": [NSString stringWithUTF8String:logStatus.format.c_str()],
        @"preventSleep": @(logStatus.preventSleep),
        @"rta": rtaArray
    };

    NSData *jsonData = [NSJSONSerialization dataWithJSONObject:payload options:0 error:nil];
    if (jsonData) {
        NSString *jsonStr = [[NSString alloc] initWithData:jsonData encoding:NSUTF8StringEncoding];
        [self callJS:[NSString stringWithFormat:@"window.onMetrics(%@)", jsonStr]];
    }
}

- (void)callJS:(NSString *)script {
    [webView evaluateJavaScript:script completionHandler:nil];
}

- (void)webView:(WKWebView *)webView didFinishNavigation:(WKNavigation *)navigation {
    [self sendInitialState];
}

@end
