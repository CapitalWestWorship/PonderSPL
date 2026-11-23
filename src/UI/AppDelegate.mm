#import "AppDelegate.h"

static AppDelegate *gSharedDelegate = nil;

@implementation AppDelegate

@synthesize isTerminating;

+ (AppDelegate *)sharedDelegate {
    return gSharedDelegate;
}

- (instancetype)init {
    self = [super init];
    if (self) {
        gSharedDelegate = self;
        isTerminating = NO;
    }
    return self;
}

- (void)applicationDidFinishLaunching:(NSNotification *)aNotification {
    [NSApp setActivationPolicy:NSApplicationActivationPolicyRegular];

    NSMenu *menubar = [[NSMenu alloc] init];
    NSMenuItem *appMenuItem = [[NSMenuItem alloc] init];
    [menubar addItem:appMenuItem];
    [NSApp setMainMenu:menubar];

    NSMenu *appMenu = [[NSMenu alloc] init];
    NSString *appName = @"Ponder SPL";
    NSString *quitTitle = [@"Quit " stringByAppendingString:appName];
    NSMenuItem *quitMenuItem = [[NSMenuItem alloc] initWithTitle:quitTitle
                                                          action:@selector(terminate:)
                                                   keyEquivalent:@"q"];
    [appMenu addItem:quitMenuItem];
    [appMenuItem setSubmenu:appMenu];

    // Window menu
    NSMenuItem *windowMenuItem = [[NSMenuItem alloc] init];
    [menubar addItem:windowMenuItem];
    NSMenu *windowMenu = [[NSMenu alloc] initWithTitle:@"Window"];
    [windowMenu addItem:[[NSMenuItem alloc] initWithTitle:@"Minimize" action:@selector(performMiniaturize:) keyEquivalent:@"m"]];
    [windowMenu addItem:[[NSMenuItem alloc] initWithTitle:@"Zoom" action:@selector(performZoom:) keyEquivalent:@""]];
    [windowMenuItem setSubmenu:windowMenu];

    mainWindowController = [[MainWindowController alloc] init];
    [mainWindowController showWindow:nil];
    [mainWindowController restoreInterfaceState];
    [NSApp activateIgnoringOtherApps:YES];
}

- (BOOL)applicationShouldTerminateAfterLastWindowClosed:(NSApplication *)sender {
    return YES;
}

- (NSApplicationTerminateReply)applicationShouldTerminate:(NSApplication *)sender {
    isTerminating = YES;
    if (mainWindowController) {
        [mainWindowController saveWindowState];
    }
    return NSTerminateNow;
}

- (void)applicationWillTerminate:(NSNotification *)notification {
    isTerminating = YES;
    if (mainWindowController) {
        [mainWindowController saveWindowState];
    }
}

@end
