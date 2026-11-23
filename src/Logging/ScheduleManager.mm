#import "ScheduleManager.h"

@implementation ScheduleEvent

- (NSDictionary *)toDictionary {
    return @{
        @"id": self.eventId ? self.eventId : @"",
        @"name": self.name ? self.name : @"Event",
        @"enabled": @(self.enabled),
        @"recurrence": self.recurrence ? self.recurrence : @"weekly",
        @"days": self.days ? self.days : @[],
        @"date": self.date ? self.date : @"",
        @"startTime": self.startTime ? self.startTime : @"08:00",
        @"endTime": self.endTime ? self.endTime : @"12:00",
        @"intervalMs": @(self.intervalMs > 0 ? self.intervalMs : 3000),
        @"format": self.format ? self.format : @"txt",
        @"preventSleep": @(self.preventSleep)
    };
}

+ (ScheduleEvent *)fromDictionary:(NSDictionary *)dict {
    ScheduleEvent *e = [[ScheduleEvent alloc] init];
    e.eventId = dict[@"id"] ? dict[@"id"] : [[NSUUID UUID] UUIDString];
    e.name = dict[@"name"] ? dict[@"name"] : @"Event";
    e.enabled = [dict[@"enabled"] boolValue];
    e.recurrence = dict[@"recurrence"] ? dict[@"recurrence"] : @"weekly";
    e.days = dict[@"days"] ? dict[@"days"] : @[];
    e.date = dict[@"date"] ? dict[@"date"] : @"";
    e.startTime = dict[@"startTime"] ? dict[@"startTime"] : @"08:00";
    e.endTime = dict[@"endTime"] ? dict[@"endTime"] : @"12:00";
    e.intervalMs = [dict[@"intervalMs"] intValue] > 0 ? [dict[@"intervalMs"] intValue] : 3000;
    e.format = dict[@"format"] ? dict[@"format"] : @"txt";
    e.preventSleep = [dict[@"preventSleep"] boolValue];
    return e;
}

@end

@implementation ScheduleManager

- (instancetype)initWithCSVLogger:(CSVLogger *)logger {
    self = [super init];
    if (self) {
        csvLogger = logger;
        events = [NSMutableArray array];
        activeScheduledEventId = nil;

        [self loadSavedEvents];

        // Start timer to check schedule every 1 second
        checkTimer = [NSTimer scheduledTimerWithTimeInterval:1.0
                                                      target:self
                                                    selector:@selector(checkSchedule)
                                                    userInfo:nil
                                                     repeats:YES];
    }
    return self;
}

- (void)dealloc {
    [checkTimer invalidate];
    checkTimer = nil;
}

- (void)loadSavedEvents {
    NSData *data = [[NSUserDefaults standardUserDefaults] objectForKey:@"Pondera_ScheduledEvents"];
    if (data) {
        NSArray *arr = [NSJSONSerialization JSONObjectWithData:data options:0 error:nil];
        if (arr && [arr isKindOfClass:[NSArray class]]) {
            for (NSDictionary *d in arr) {
                [events addObject:[ScheduleEvent fromDictionary:d]];
            }
        }
    }

    if (events.count == 0) {
        // Create initial default for user
        ScheduleEvent *sunday = [[ScheduleEvent alloc] init];
        sunday.eventId = [[NSUUID UUID] UUIDString];
        sunday.name = @"Sunday Morning Service";
        sunday.enabled = NO; // Off by default until user enables
        sunday.recurrence = @"weekly";
        sunday.days = @[@0]; // Sunday (0)
        sunday.startTime = @"08:30";
        sunday.endTime = @"12:30";
        sunday.intervalMs = 3000;
        sunday.format = @"csv";
        sunday.preventSleep = NO;
        [events addObject:sunday];
        [self saveEventsToDefaults];
    }
}

- (void)saveEventsToDefaults {
    NSMutableArray *arr = [NSMutableArray array];
    for (ScheduleEvent *e in events) {
        [arr addObject:[e toDictionary]];
    }
    NSData *data = [NSJSONSerialization dataWithJSONObject:arr options:0 error:nil];
    if (data) {
        [[NSUserDefaults standardUserDefaults] setObject:data forKey:@"Pondera_ScheduledEvents"];
    }
}

- (NSArray<NSDictionary *> *)getEventsAsArray {
    NSMutableArray *arr = [NSMutableArray array];
    for (ScheduleEvent *e in events) {
        [arr addObject:[e toDictionary]];
    }
    return arr;
}

- (void)saveEventsFromArray:(NSArray<NSDictionary *> *)arr {
    [events removeAllObjects];
    for (NSDictionary *d in arr) {
        [events addObject:[ScheduleEvent fromDictionary:d]];
    }
    [self saveEventsToDefaults];
}

- (void)addEvent:(ScheduleEvent *)event {
    [events addObject:event];
    [self saveEventsToDefaults];
}

- (void)removeEventWithId:(NSString *)eventId {
    for (NSInteger i = events.count - 1; i >= 0; --i) {
        if ([events[i].eventId isEqualToString:eventId]) {
            [events removeObjectAtIndex:i];
        }
    }
    [self saveEventsToDefaults];
}

- (void)toggleEvent:(NSString *)eventId enabled:(BOOL)enabled {
    for (ScheduleEvent *e in events) {
        if ([e.eventId isEqualToString:eventId]) {
            e.enabled = enabled;
            break;
        }
    }
    [self saveEventsToDefaults];
}

- (void)checkSchedule {
    NSDate *now = [NSDate date];
    NSCalendar *calendar = [NSCalendar currentCalendar];
    NSDateComponents *comp = [calendar components:(NSCalendarUnitYear | NSCalendarUnitMonth | NSCalendarUnitDay |
                                                   NSCalendarUnitWeekday | NSCalendarUnitHour | NSCalendarUnitMinute)
                                         fromDate:now];

    int weekdayIndex = (int)comp.weekday - 1; // 0 = Sunday, 1 = Monday...
    NSString *todayDateStr = [NSString stringWithFormat:@"%04ld-%02ld-%02ld", (long)comp.year, (long)comp.month, (long)comp.day];
    int currentMinutes = (int)comp.hour * 60 + (int)comp.minute;

    ScheduleEvent *matchingActiveEvent = nil;

    for (ScheduleEvent *e in events) {
        if (!e.enabled) continue;

        NSArray *startParts = [e.startTime componentsSeparatedByString:@":"];
        NSArray *endParts = [e.endTime componentsSeparatedByString:@":"];
        if (startParts.count < 2 || endParts.count < 2) continue;

        int startMin = [startParts[0] intValue] * 60 + [startParts[1] intValue];
        int endMin = [endParts[0] intValue] * 60 + [endParts[1] intValue];
        if (currentMinutes < startMin || currentMinutes >= endMin) continue;

        // Check recurrence
        if ([e.recurrence isEqualToString:@"one-off"]) {
            if ([e.date isEqualToString:todayDateStr]) {
                matchingActiveEvent = e;
                break;
            }
        } else if ([e.recurrence isEqualToString:@"weekly"]) {
            for (NSNumber *dayNum in e.days) {
                if ([dayNum intValue] == weekdayIndex) {
                    matchingActiveEvent = e;
                    break;
                }
            }
            if (matchingActiveEvent) break;
        } else if ([e.recurrence isEqualToString:@"daily"]) {
            matchingActiveEvent = e;
            break;
        }
    }

    if (matchingActiveEvent) {
        if (activeScheduledEventId == nil) {
            // Trigger start
            activeScheduledEventId = matchingActiveEvent.eventId;
            [csvLogger startLoggingWithDirectory:""
                                      intervalMs:matchingActiveEvent.intervalMs
                                          format:[matchingActiveEvent.format UTF8String]
                                       eventName:[matchingActiveEvent.name UTF8String]
                                    preventSleep:matchingActiveEvent.preventSleep];
            NSLog(@"[ScheduleManager] Auto-started scheduled logging for: %@", matchingActiveEvent.name);
        }
    } else {
        if (activeScheduledEventId != nil) {
            // End of scheduled window reached
            [csvLogger stopLogging];
            NSLog(@"[ScheduleManager] Scheduled logging window ended. Log stopped.");
            activeScheduledEventId = nil;
        }
    }
}

@end
