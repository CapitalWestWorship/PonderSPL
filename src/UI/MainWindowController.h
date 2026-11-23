#pragma once
#import <Cocoa/Cocoa.h>
#import <WebKit/WebKit.h>
#import <AVFoundation/AVFoundation.h>
#include "SPLEngine.h"
#import "AudioDeviceManager.h"
#import "CSVLogger.h"
#import "ScheduleManager.h"
#import "HUDWindowController.h"

@interface MainWindowController : NSWindowController <WKScriptMessageHandler, WKNavigationDelegate, NSWindowDelegate> {
    WKWebView *webView;
    SPLEngine *splEngine;
    AudioDeviceManager *audioManager;
    CSVLogger *csvLogger;
    ScheduleManager *scheduleManager;
    HUDWindowController *hudController;
    NSTimer *updateTimer;
}

- (instancetype)init;
- (void)saveWindowState;
- (void)restoreInterfaceState;

@end
