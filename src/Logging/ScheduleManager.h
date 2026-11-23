#pragma once
#import <Foundation/Foundation.h>
#import "CSVLogger.h"

@interface ScheduleEvent : NSObject
@property (nonatomic, copy) NSString *eventId;
@property (nonatomic, copy) NSString *name;
@property (nonatomic, assign) BOOL enabled;
@property (nonatomic, copy) NSString *recurrence; // "one-off", "weekly", "daily"
@property (nonatomic, strong) NSArray<NSNumber *> *days; // 0=Sunday, 1=Monday...
@property (nonatomic, copy) NSString *date; // YYYY-MM-DD
@property (nonatomic, copy) NSString *startTime; // HH:MM
@property (nonatomic, copy) NSString *endTime;   // HH:MM
@property (nonatomic, assign) int intervalMs;
@property (nonatomic, copy) NSString *format; // "csv" or "txt"
@property (nonatomic, assign) BOOL preventSleep;

- (NSDictionary *)toDictionary;
+ (ScheduleEvent *)fromDictionary:(NSDictionary *)dict;
@end

@interface ScheduleManager : NSObject {
    CSVLogger *csvLogger;
    NSMutableArray<ScheduleEvent *> *events;
    NSTimer *checkTimer;
    NSString *activeScheduledEventId;
}

- (instancetype)initWithCSVLogger:(CSVLogger *)logger;
- (NSArray<NSDictionary *> *)getEventsAsArray;
- (void)saveEventsFromArray:(NSArray<NSDictionary *> *)arr;
- (void)addEvent:(ScheduleEvent *)event;
- (void)removeEventWithId:(NSString *)eventId;
- (void)toggleEvent:(NSString *)eventId enabled:(BOOL)enabled;

@end
