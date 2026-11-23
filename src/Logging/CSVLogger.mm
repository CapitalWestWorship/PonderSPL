#import "CSVLogger.h"
#import <Cocoa/Cocoa.h>
#include <iomanip>
#include <sstream>
#include <chrono>

// Version string from Info.plist (e.g. "2.1.0"), so log headers stay in sync with the build.
static std::string appVersion() {
    NSString *v = [[NSBundle mainBundle] objectForInfoDictionaryKey:@"CFBundleShortVersionString"];
    return v ? std::string([v UTF8String]) : std::string("?");
}

@implementation CSVLogger

- (instancetype)initWithSPLEngine:(SPLEngine*)engine {
    self = [super init];
    if (self) {
        splEngine = engine;
        isRunning = false;
        isPaused = false;
        sampleIntervalMs = 3000; // Default 3 seconds
        recordCount = 0;
        currentPath = "";
        logFormat = "txt";
        preventSleepDuringLogging = false;
        hasSleepAssertion = false;
        sleepAssertionID = kIOPMNullAssertionID;

        NSString *docs = [NSSearchPathForDirectoriesInDomains(NSDocumentDirectory, NSUserDomainMask, YES) firstObject];
        NSString *logDir = [docs stringByAppendingPathComponent:@"Ponder_Logs"];
        NSString *legacyDir = [docs stringByAppendingPathComponent:@"Pondera_Logs"];
        NSFileManager *fm = [NSFileManager defaultManager];

        // One-time migration: carry logs over from the old "Pondera" folder name.
        if ([fm fileExistsAtPath:legacyDir] && ![fm fileExistsAtPath:logDir]) {
            [fm moveItemAtPath:legacyDir toPath:logDir error:nil];
        }
        baseDirectory = [logDir UTF8String];

        [fm createDirectoryAtPath:logDir
                                  withIntermediateDirectories:YES
                                                   attributes:nil
                                                        error:nil];
    }
    return self;
}

- (void)dealloc {
    [self stopLogging];
}

- (std::string)getDefaultLogDirectory {
    return baseDirectory;
}

- (BOOL)startLoggingWithDirectory:(const std::string&)dir
                       intervalMs:(int)intervalMs
                           format:(const std::string&)format
                        eventName:(const std::string&)eventName
                     preventSleep:(BOOL)preventSleep {
    [self stopLogging];

    logFormat = (format == "csv") ? "csv" : "txt";
    preventSleepDuringLogging = preventSleep;

    std::string targetDir = dir.empty() ? baseDirectory : dir;
    NSString *nsTargetDir = [NSString stringWithUTF8String:targetDir.c_str()];
    [[NSFileManager defaultManager] createDirectoryAtPath:nsTargetDir
                              withIntermediateDirectories:YES
                                               attributes:nil
                                                    error:nil];

    auto now = std::chrono::system_clock::now();
    std::time_t now_time = std::chrono::system_clock::to_time_t(now);
    std::tm tm_now;
    localtime_r(&now_time, &tm_now);

    char timeBuf[64];
    std::strftime(timeBuf, sizeof(timeBuf), "%Y-%m-%d_%H-%M-%S", &tm_now);

    std::string safeName = eventName;
    for (char &c : safeName) {
        if (!isalnum(c) && c != '-' && c != '_') c = '_';
    }
    if (safeName.empty()) safeName = "Session";

    std::string extension = (logFormat == "txt") ? ".txt" : ".csv";
    std::string filename = "Ponder_Log_" + safeName + "_" + std::string(timeBuf) + extension;
    NSString *fullPath = [nsTargetDir stringByAppendingPathComponent:[NSString stringWithUTF8String:filename.c_str()]];
    currentPath = [fullPath UTF8String];

    std::lock_guard<std::mutex> lock(fileMutex);
    logFile.open(currentPath, std::ios::out | std::ios::trunc);
    if (!logFile.is_open()) {
        NSLog(@"[CSVLogger] Failed to open log file at %s", currentPath.c_str());
        return NO;
    }

    SPLMetrics initM = splEngine ? splEngine->getMetrics() : SPLMetrics();

    if (logFormat == "txt") {
        // Smaart-style Tab-Delimited format with Acoustic Metadata Header
        logFile << "[Ponder SPL Acoustic Log File]\n"
                << "Application:\tPonder SPL v" << appVersion() << " (macOS Universal)\n"
                << "Session:\t" << eventName << "\n"
                << "Start_Time:\t" << timeBuf << "\n"
                << "Interval_ms:\t" << intervalMs << "\n"
                << "Cal_Offset_dB:\t" << std::fixed << std::setprecision(1) << initM.offset_dB << "\n"
                << "Mic_Profile:\t" << (initM.isCalFileLoaded ? initM.calFileName : "None (Flat)") << "\n"
                << "--------------------------------------------------------------------------------\n";
        logFile << "Timestamp_ISO\tTime_Local\tElapsed_Sec\t"
                << "LA_Fast\tLA_Slow\tLA_eq1s\tLA_eq1m\tLA_eq15m\t"
                << "LC_Fast\tLC_Slow\tLC_eq1s\tLZ_Fast\tLZ_Slow\t"
                << "C_minus_A\tLC_Peak\n";
    } else {
        // Standard CSV format
        logFile << "Timestamp_ISO,Time_Local,Elapsed_Sec,"
                << "LA_Fast_dBA,LA_Slow_dBA,LA_eq1s_dBA,LA_eq1m_dBA,LA_eq15m_dBA,"
                << "LC_Fast_dBC,LC_Slow_dBC,LC_eq1s_dBC,LZ_Fast_dBZ,LZ_Slow_dBZ,"
                << "C_minus_A_dB,LC_Peak_dBC,LZ_Peak_dBZ,Offset_dB,Cal_File\n";
    }
    logFile.flush();

    sampleIntervalMs = intervalMs > 50 ? intervalMs : 3000;
    recordCount = 0;
    isRunning = true;
    isPaused = false;
    startTime = std::chrono::steady_clock::now();

    // Prevent Mac sleep if requested
    if (preventSleepDuringLogging) {
        CFStringRef reason = CFSTR("Ponder SPL Active Sound Pressure Logging");
        IOReturn ret = IOPMAssertionCreateWithName(kIOPMAssertionTypePreventUserIdleSystemSleep,
                                                  kIOPMAssertionLevelOn,
                                                  reason,
                                                  &sleepAssertionID);
        if (ret == kIOReturnSuccess) {
            hasSleepAssertion = true;
            NSLog(@"[CSVLogger] Mac sleep prevention assertion acquired.");
        }
    }

    logThread = std::thread([self]() {
        const char delim = (logFormat == "txt") ? '\t' : ',';

        while (isRunning) {
            std::this_thread::sleep_for(std::chrono::milliseconds(sampleIntervalMs));
            if (!isRunning) break;
            if (isPaused) continue;

            if (splEngine) {
                SPLMetrics m = splEngine->getMetrics();

                auto sysNow = std::chrono::system_clock::now();
                std::time_t sysTime = std::chrono::system_clock::to_time_t(sysNow);
                std::tm tmLocal;
                localtime_r(&sysTime, &tmLocal);

                char isoBuf[32];
                std::strftime(isoBuf, sizeof(isoBuf), "%Y-%m-%dT%H:%M:%S", &tmLocal);

                char localBuf[32];
                std::strftime(localBuf, sizeof(localBuf), "%H:%M:%S", &tmLocal);

                auto elapsedDuration = std::chrono::steady_clock::now() - startTime;
                double elapsedSec = std::chrono::duration<double>(elapsedDuration).count();

                std::lock_guard<std::mutex> lock(fileMutex);
                if (logFile.is_open()) {
                    logFile << isoBuf << delim
                            << localBuf << delim
                            << std::fixed << std::setprecision(1) << elapsedSec << delim
                            << std::fixed << std::setprecision(1) << m.LAF << delim
                            << std::fixed << std::setprecision(1) << m.LAS << delim
                            << std::fixed << std::setprecision(1) << m.LAeq_1s << delim
                            << std::fixed << std::setprecision(1) << m.LAeq_1m << delim
                            << std::fixed << std::setprecision(1) << m.LAeq_15m << delim
                            << std::fixed << std::setprecision(1) << m.LCF << delim
                            << std::fixed << std::setprecision(1) << m.LCS << delim
                            << std::fixed << std::setprecision(1) << m.LCeq_1s << delim
                            << std::fixed << std::setprecision(1) << m.LZF << delim
                            << std::fixed << std::setprecision(1) << m.LZS << delim
                            << std::fixed << std::setprecision(1) << m.CminusA << delim
                            << std::fixed << std::setprecision(1) << m.LCpeak;

                    if (logFormat == "csv") {
                        logFile << delim << std::fixed << std::setprecision(1) << m.LZpeak
                                << delim << std::fixed << std::setprecision(1) << m.offset_dB
                                << delim << (m.isCalFileLoaded ? m.calFileName : "None");
                    }
                    logFile << "\n";
                    logFile.flush();
                    recordCount++;
                }
            }
        }
    });

    NSLog(@"[CSVLogger] Logging started to: %s (interval: %d ms, format: %s, sleepPrevent: %d)",
          currentPath.c_str(), intervalMs, logFormat.c_str(), preventSleepDuringLogging);
    return YES;
}

- (void)pauseLogging {
    isPaused = true;
}

- (void)resumeLogging {
    isPaused = false;
}

- (void)stopLogging {
    if (isRunning) {
        isRunning = false;
        if (logThread.joinable()) {
            logThread.join();
        }
        std::lock_guard<std::mutex> lock(fileMutex);
        if (logFile.is_open()) {
            logFile.flush();
            logFile.close();
        }

        if (hasSleepAssertion) {
            IOPMAssertionRelease(sleepAssertionID);
            hasSleepAssertion = false;
            NSLog(@"[CSVLogger] Mac sleep prevention assertion released.");
        }

        NSLog(@"[CSVLogger] Logging stopped. Total records: %llu", recordCount.load());
    }
}

- (LogStatus)getStatus {
    LogStatus s;
    s.isLogging = isRunning;
    s.isPaused = isPaused;
    s.recordCount = recordCount;
    if (isRunning) {
        auto elapsed = std::chrono::steady_clock::now() - startTime;
        s.elapsedSeconds = std::chrono::duration<double>(elapsed).count();
    } else {
        s.elapsedSeconds = 0.0;
    }
    s.currentFilePath = currentPath;
    s.intervalMs = sampleIntervalMs;
    s.format = logFormat;
    s.preventSleep = preventSleepDuringLogging;
    return s;
}

- (void)revealInFinder {
    if (!currentPath.empty()) {
        NSString *path = [NSString stringWithUTF8String:currentPath.c_str()];
        [[NSWorkspace sharedWorkspace] selectFile:path inFileViewerRootedAtPath:@""];
    } else {
        NSString *dir = [NSString stringWithUTF8String:baseDirectory.c_str()];
        [[NSWorkspace sharedWorkspace] openURL:[NSURL fileURLWithPath:dir]];
    }
}

@end
