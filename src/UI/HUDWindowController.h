#pragma once
#import <Cocoa/Cocoa.h>
#import <WebKit/WebKit.h>
#include "SPLEngine.h"
#import "CSVLogger.h"

@interface HUDWindowController : NSWindowController <WKScriptMessageHandler, WKNavigationDelegate, NSWindowDelegate> {
    WKWebView *webView;
    SPLEngine *splEngine;
    CSVLogger *csvLogger;
    NSTimer *updateTimer;
    BOOL isAlwaysOnTop;
}

- (instancetype)initWithSPLEngine:(SPLEngine *)engine csvLogger:(CSVLogger *)logger;
- (void)toggleAlwaysOnTop:(BOOL)floating;
- (BOOL)getAlwaysOnTop;
- (void)showHUD;
- (void)saveWindowState;

@end
