#pragma once
#import <Cocoa/Cocoa.h>
#import "MainWindowController.h"

@interface AppDelegate : NSObject <NSApplicationDelegate> {
    MainWindowController *mainWindowController;
    BOOL isTerminating;
}

@property (nonatomic, assign) BOOL isTerminating;
+ (AppDelegate *)sharedDelegate;

@end
